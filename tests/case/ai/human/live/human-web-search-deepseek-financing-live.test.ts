import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { createWebCrawlerService } from '../../../../harness/backend/webCrawlerTestUtils'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'
import type { JsonObject, JsonValue } from '../../../../../src/shared/types'

const USER_INPUT =
  '请使用网页搜索工具搜索 deepseek最近融资情况，然后基于搜索到的候选网页简要说明当前能看到的信息。不要直接编造。'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readSearchResultCount = (value: JsonValue | undefined): number => {
  if (!isJsonObject(value) || !Array.isArray(value.results)) return 0
  return value.results.length
}

describe('ai human live backend', () => {
  it('human-web-search-deepseek-financing-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-web-search-deepseek-financing-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 human 会针对 deepseek 最近融资情况调用 web_search，并拿到结构化候选网页。',
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
              allowedToolNames: ['web_search', 'web_crawl'],
              webCrawlerService
            })
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: USER_INPUT
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
              message: '未提供 live 模型配置，已跳过 human web search deepseek financing live case。'
            })
            return
          }

          const toolStarts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
          const searchInputs = toolStarts
            .filter((event) => event.toolName === 'web_search')
            .map((event) => event.input)
          const searchQueries = searchInputs
            .map((input) => input.query)
            .filter((value): value is string => typeof value === 'string')
          const searchResults = toolResults.filter((event) => event.toolName === 'web_search')
          const successfulSearchResults = searchResults.filter((event) => event.result?.ok === true)
          const latestSearchResult = searchResults.at(-1)
          const latestSearchResultCount = readSearchResultCount(latestSearchResult?.result?.data)
          const deliveryText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed'
              && searchQueries.some((query) => /deepseek/i.test(query) && /融资|financ|fund/i.test(query))
              && successfulSearchResults.length > 0
              && latestSearchResultCount > 0
              && /deepseek/i.test(deliveryText)
              && /融资|估值|投资|fund|financ/i.test(deliveryText),
            {
              name: 'human-live-web-search-deepseek-financing',
              message:
                'live human 应针对 deepseek 最近融资情况调用 web_search，拿到非空候选网页，并基于搜索结果给出回答。',
              data: {
                searchQueries,
                latestSearchResultCount,
                latestSearchError: latestSearchResult?.error || null,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
