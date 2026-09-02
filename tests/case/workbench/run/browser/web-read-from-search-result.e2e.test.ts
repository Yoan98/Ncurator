import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  assertWorkbenchLocalSearchResultsPanelHidden,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'web-read-from-search-result'
const PROMPT =
  '请用网页搜索工具搜索一次「DeepSeek 最近融资」，从结果里选 1 条最相关新闻链接，再用 fetch 读取该页正文后总结。只搜索一次、只 fetch 一个 URL，不要重复搜索或多个网页，不要编造。'

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readWebSearchInput = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' }>,
  key: 'query' | 'url' | 'type'
): string => {
  const input = event.input as JsonValue
  if (!isObjectRecord(input)) return ''
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

const readContentMarkdown = (events: AiRunEvent[]): string => {
  for (const event of events) {
    if (event.type !== 'tool_call_result' || event.toolName !== 'web_search') continue
    const data = event.result?.data
    if (!isObjectRecord(data)) continue
    const markdown = data.markdown
    if (typeof markdown === 'string' && markdown.length > 0) return markdown
  }
  return ''
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
        description: '真实 AI 用 web_search 搜索 DeepSeek 融资并读取网页正文后总结。',
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
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const toolStarts = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
              event.type === 'tool_call_started'
          )
          const searchStarts = toolStarts.filter((event) => event.toolName === 'web_search')
          const searchResults = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
              event.type === 'tool_call_result' && event.toolName === 'web_search'
          )
          const fetchOk = searchResults.some(
            (event) =>
              event.result?.ok === true &&
              isObjectRecord(event.result.data) &&
              typeof event.result.data.markdown === 'string' &&
              event.result.data.markdown.length > 0
          )

          return {
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type),
            searchQueries: searchStarts
              .filter((event) => readWebSearchInput(event, 'type') === 'search')
              .map((event) => readWebSearchInput(event, 'query')),
            fetchUrls: searchStarts
              .filter((event) => readWebSearchInput(event, 'type') === 'fetch')
              .map((event) => readWebSearchInput(event, 'url')),
            searchOk: searchResults.some((event) => event.result?.ok === true),
            fetchOk,
            contentMarkdown: readContentMarkdown(evidence.events),
            searchErrors: searchResults.map((event) => event.error || '').filter(Boolean)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('run_completed') &&
              result.searchQueries.some((query) => /deepseek/i.test(query)) &&
              result.searchOk &&
              result.fetchOk &&
              result.contentMarkdown.length > 0 &&
              /deepseek/i.test(result.finalAnswerText) &&
              /融资|估值|投资|fund|financ/i.test(result.finalAnswerText),
            {
              name: 'workbench-web-read-from-search-result',
              message: '真实 e2e 应用 web_search 搜索 DeepSeek 融资并读取网页正文后基于正文回答。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
          await assertWorkbenchLocalSearchResultsPanelHidden(runtime.page)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
