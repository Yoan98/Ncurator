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
  '请搜索 deepseek 最近的融资情况，读取最相关网页正文后说明。需要先用网页搜索工具读取网页正文，不要直接编造。'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readContentMarkdown = (event: AiRunEvent): string => {
  if (event.type !== 'tool_call_result' || event.toolName !== 'web_search') return ''
  const data = event.result?.data
  if (!isObjectRecord(data)) return ''
  const markdown = data.markdown
  return typeof markdown === 'string' ? markdown : ''
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
          '真实 AI 用 deepseek 最近的融资情况触发 web_search，验证搜索工具链能搜索并读取网页正文。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
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
            contentMarkdown: latestSearchResult ? readContentMarkdown(latestSearchResult) : '',
            searchError: latestSearchResult?.error || '',
            searchOk: latestSearchResult?.result?.ok === true
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.searchQueries.length > 0 &&
              result.searchQueries.some((query) => /deepseek/i.test(query)) &&
              result.searchOk &&
              result.contentMarkdown.length > 0 &&
              !result.searchError,
            {
              name: 'workbench-web-search-deepseek-diagnostic',
              message: '真实 e2e 应用 DeepSeek 融资问句触发 web_search，并读取到网页正文。',
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
