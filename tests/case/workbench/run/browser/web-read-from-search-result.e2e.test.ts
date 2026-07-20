import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'web-read-from-search-result'
const PROMPT =
  '请搜索 DeepSeek 最近融资情况，选择最相关的候选网页继续读取网页正文后再总结。必须先用网页搜索工具，再用网页读取工具，不要只列搜索结果，也不要直接编造。'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readToolInputString = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' }>,
  key: string
): string => {
  const input = event.input as JsonValue
  if (!isObjectRecord(input)) return ''
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

const readSearchResultCount = (event: AiRunEvent): number => {
  if (event.type !== 'tool_call_result' || event.toolName !== 'web_search') return 0
  const data = event.result?.data
  if (!isObjectRecord(data)) return 0
  const results = data.results
  return Array.isArray(results) ? results.length : 0
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description:
          '真实 AI 先用 web_search 搜索 DeepSeek 融资候选网页，再用 web_crawl 读取网页正文后总结。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          try {
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, PROMPT)
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)

            const toolStarts = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
                event.type === 'tool_call_started'
            )
            const searchStarts = toolStarts.filter((event) => event.toolName === 'web_search')
            const crawlStarts = toolStarts.filter((event) => event.toolName === 'web_crawl')
            const searchResults = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                event.type === 'tool_call_result' && event.toolName === 'web_search'
            )
            const crawlResults = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                event.type === 'tool_call_result' && event.toolName === 'web_crawl'
            )
            const latestSearchResult = searchResults.at(-1)

            return {
              finalAnswerText: evidence.finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type),
              searchQueries: searchStarts.map((event) => readToolInputString(event, 'query')),
              crawlUrls: crawlStarts.map((event) => readToolInputString(event, 'url')),
              searchResultCount: latestSearchResult ? readSearchResultCount(latestSearchResult) : 0,
              searchOk: searchResults.some((event) => event.result?.ok === true),
              crawlOk: crawlResults.some((event) => event.result?.ok === true),
              crawlErrors: crawlResults.map((event) => event.error || '').filter(Boolean)
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.searchQueries.some((query) => /deepseek/i.test(query)) &&
              result.searchOk &&
              result.searchResultCount > 0 &&
              result.crawlUrls.length > 0 &&
              result.crawlOk &&
              /deepseek/i.test(result.finalAnswerText) &&
              /融资|估值|投资|fund|financ/i.test(result.finalAnswerText),
            {
              name: 'workbench-web-read-from-search-result',
              message:
                '真实 e2e 应先搜索 DeepSeek 融资候选网页，再读取至少一个网页正文并基于正文回答。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
