import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const isPandasHost = (url: string): boolean => new URL(url).hostname.endsWith('pandas.pydata.org')

describe('ai human live backend', () => {
  it('human-web-crawl-url-inference-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-crawl-url-inference-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '找到 pandas 官方 CSV 接口并向用户直接说明。',
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
                '只使用 pandas.pydata.org 官方文档，找到 CSV 读取和写入的 API，然后向我说明。读完两个官方 API 页面后停止。'
            })
            return { output, events: runtime.eventCollector.snapshot() }
          } finally {
            await webCrawlerService.close()
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const urls = starts
            .filter((event) => event.toolName === 'web_crawl')
            .map((event) => String(event.input.url || ''))
          const officialUrls = urls.filter(isPandasHost)
          const nonOfficialUrls = urls.filter((url) => !isPandasHost(url))
          runtime.assertThat(
            result.output.status === 'completed' &&
              officialUrls.length >= 2 &&
              !starts.some((event) => ['browser_use', 'terminal_run'].includes(event.toolName)),
            {
              name: 'human-live-web-crawl-url-inference-uses-official-sources',
              message: 'The live model must obtain the requested official API sources before answering the user.',
              data: { urls, nonOfficialUrls }
            }
          )
        }
      })
    })
  })
})
