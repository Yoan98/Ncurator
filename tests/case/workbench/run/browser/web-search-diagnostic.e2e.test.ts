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

const CASE_ID = 'web-search-diagnostic'
const PROMPT =
  '请搜索 deepseek 最近的融资情况，并说明你搜索到了哪些候选网页。需要先用网页搜索工具，不要直接编造。'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
          '真实 AI 用 deepseek 最近的融资情况触发 web_search，验证搜索工具链能把关键词交给 ddgs 并返回候选网页。',
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
            recordWorkbenchAiEvidence(runtime, evidence, 0.75)

            const searchStarts = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
                event.type === 'tool_call_started' && event.toolName === 'web_search'
            )
            const searchResults = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                event.type === 'tool_call_result' && event.toolName === 'web_search'
            )
            const latestSearchResult = searchResults.at(-1)

            return {
              finalAnswerText: evidence.finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type),
              searchQueries: searchStarts.map((event) => {
                const input = event.input as JsonValue
                return isObjectRecord(input) ? String(input.query || '') : ''
              }),
              searchResultCount: latestSearchResult ? readSearchResultCount(latestSearchResult) : 0,
              searchError: latestSearchResult?.error || '',
              searchOk: latestSearchResult?.result?.ok === true
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.searchQueries.length > 0 &&
              result.searchQueries.some((query) => /deepseek/i.test(query)) &&
              result.searchOk &&
              result.searchResultCount > 0 &&
              !result.searchError,
            {
              name: 'workbench-web-search-deepseek-diagnostic',
              message:
                '真实 e2e 应用 DeepSeek 融资问句触发 web_search，并拿到至少一个结构化候选网页结果。',
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
