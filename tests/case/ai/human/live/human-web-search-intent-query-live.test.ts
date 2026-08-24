import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const isPandasHost = (url: string): boolean => {
  if (!url) return false
  try {
    return new URL(url).hostname.endsWith('pandas.pydata.org')
  } catch {
    return false
  }
}

describe('ai human live backend', () => {
  it('human-web-search-intent-query-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-search-intent-query-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '用户给纯文本诉求，AI 提炼搜索意图后走 web_search(query) 读官方文档回答。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const webCrawlerService = createWebCrawlerService()
          try {
            const output = await createHumanTestRunner(runtime, {
              webCrawlerService
            }).run({
              taskId: runtime.taskId,
              userInput:
                '请查找 pandas 官方文档中 CSV 读取和写入的 API 用法，然后向我说明。读完两个官方 API 页面后停止。'
            })
            return { output, events: runtime.eventCollector.snapshot() }
          } finally {
            await webCrawlerService.close()
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'web_search' && event.result?.ok === true
          )
          const queryCalls = starts.filter(
            (event) =>
              event.toolName === 'web_search' &&
              typeof event.input?.query === 'string' &&
              String(event.input.query).trim().length > 0
          )
          const readUrls = results.map((event) => {
            const data = event.result?.data
            if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
            const value = data as { finalUrl?: unknown; requestedUrl?: unknown }
            return String(value.finalUrl || value.requestedUrl || '')
          })
          const officialUrls = readUrls.filter(isPandasHost)
          runtime.assertThat(
            result.output.status === 'completed' &&
              queryCalls.length >= 1 &&
              officialUrls.length >= 1,
            {
              name: 'human-live-web-search-intent-query-reads-official-sources',
              message: '纯文本诉求下 AI 应提炼意图走 web_search(query) 并读取官方文档后回答。',
              data: {
                outputStatus: result.output?.status,
                queryCalls: queryCalls.map((event) => event.input?.query),
                readUrls,
                officialUrls
              }
            }
          )
        }
      })
    })
  })
})
