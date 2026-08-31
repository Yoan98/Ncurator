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
        description: '用户给纯文本诉求，AI 提炼搜索意图后走 web_search(type=search/fetch) 读官方文档回答。',
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
                '我记不清 pandas 官方文档的网址了，帮我搜一下官方文档里 CSV 读取和写入这两个 API 的用法页面，然后读官方页面向我说明。读完两个官方 API 页面后停止。'
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
          const searchCalls = starts.filter(
            (event) =>
              event.toolName === 'web_search' &&
              event.input?.type === 'search' &&
              typeof event.input.query === 'string' &&
              String(event.input.query).trim().length > 0
          )
          const fetchUrls = results
            .filter((event) => {
              const input = starts.find(
                (start) =>
                  start.toolName === 'web_search' &&
                  start.toolCallId === event.toolCallId &&
                  start.input?.type === 'fetch'
              )
              return Boolean(input)
            })
            .map((event) => {
            const data = event.result?.data
            if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
            const value = data as { finalUrl?: unknown; requestedUrl?: unknown }
            return String(value.finalUrl || value.requestedUrl || '')
          })
          const officialUrls = fetchUrls.filter(isPandasHost)
          runtime.assertThat(
            result.output.status === 'completed' &&
              searchCalls.length >= 1 &&
              officialUrls.length >= 1,
            {
              name: 'human-live-web-search-intent-query-reads-official-sources',
              message:
                '纯文本诉求下 AI 应使用 web_search(type=search) 获取候选，并通过 type=fetch 读取官方文档后回答。',
              data: {
                outputStatus: result.output?.status,
                searchCalls: searchCalls.map((event) => event.input?.query),
                fetchUrls,
                officialUrls
              }
            }
          )
        }
      })
    })
  })
})
