import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { HUMAN_WEB_CRAWL_URL_INFERENCE_USER_INPUT } from '../../../../harness/backend/aiLiveTestData'
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
        description: '验证 live 模式下 human 在用户不提供网址时会先推断 pandas 官网地址，再通过 web_crawl 完成官网文档整理。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv()
          ? loadLiveLlmConfigFromEnv().model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              events: []
            }
          }

          const webCrawlerService = createWebCrawlerService()
          try {
            await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
            const runner = createHumanTestRunner(runtime, {
              allowedToolNames: ['web_crawl'],
              webCrawlerService
            })
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: HUMAN_WEB_CRAWL_URL_INFERENCE_USER_INPUT
            })
            return {
              skipped: false,
              output,
              events: runtime.eventCollector.snapshot()
            }
          } finally {
            await webCrawlerService.close()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human web crawl url inference live case。'
            })
            return
          }

          const toolStarts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const startedToolNames = toolStarts.map((event) => event.toolName)
          const startedUrls = toolStarts
            .filter((event) => event.toolName === 'web_crawl')
            .map((event) => event.input.url)
            .filter((value): value is string => typeof value === 'string')
          const deliveryText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed'
              && startedUrls.length >= 2
              && startedUrls.every(isPandasHost)
              && !startedToolNames.includes('browser_use')
              && !startedToolNames.includes('terminal_run')
              && /read_csv/i.test(deliveryText)
              && /to_csv/i.test(deliveryText)
              && /(读取.*csv|读入.*csv|加载.*csv|read.*csv)/i.test(deliveryText)
              && /(写出.*csv|导出.*csv|保存.*csv|write.*csv|export.*csv)/i.test(deliveryText),
            {
              name: 'human-live-web-crawl-url-inference-reading',
              message: 'live human 应先推断 pandas 官网地址，再通过 web_crawl 读取至少两个官网文档页面并完成整理。',
              data: {
                startedUrls,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
