import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-use-deepseek-financing-search'
const PROMPT = '用浏览器搜索下最近deepseek的融资'
const SEARCH_E2E_TIMEOUT_MS = 300_000

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

const readBrowserUseResultText = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): string => {
  const data = event.result?.data
  if (!isObjectRecord(data)) return ''
  const parts: string[] = []
  for (const key of ['summary', 'message', 'content', 'pageState']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim())
    }
  }
  const actions = data.actions
  if (Array.isArray(actions)) {
    parts.push(JSON.stringify(actions))
  }
  return parts.join('\n')
}

const waitForDeepseekBrowserSearchOutcome = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  page: Parameters<typeof sendWorkbenchMessage>[0],
  startedAtMs: number,
  modelName: string
) => {
  const deadline = Date.now() + SEARCH_E2E_TIMEOUT_MS
  const handledBatchIds = new Set<string>()

  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const runFailed = events.find((event) => event.type === 'run_failed')
    if (runFailed?.type === 'run_failed') {
      return {
        status: 'failed' as const,
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText: '',
        failure: runFailed.error
      }
    }

    const approvalRequired = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
          event.type === 'approval_batch_required'
      )
      .find((event) => !handledBatchIds.has(event.batchId))
    if (approvalRequired) {
      handledBatchIds.add(approvalRequired.batchId)
      await decideWorkbenchApprovalBatch(runtime, page, {
        event: approvalRequired,
        action: 'approve'
      })
      continue
    }

    const runCompleted = events.find((event) => event.type === 'run_completed')
    if (runCompleted?.type === 'run_completed') {
      const finalAnswerText =
        events
          .filter(
            (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
              event.type === 'answer_completed'
          )
          .map((event) => event.text)
          .at(-1) || ''
      return {
        status: 'completed' as const,
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText,
        failure: ''
      }
    }

    if (Date.now() >= deadline) {
      return {
        status: 'timed_out' as const,
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText: '',
        failure: 'AI run did not complete before diagnostic timeout'
      }
    }

    await page.waitForTimeout(500)
  }
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
          '真实 AI 使用用户原话“用浏览器搜索下最近deepseek的融资”触发 browser_use，诊断搜索页面导航、抽取和最终回答闭环。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          try {
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, PROMPT)
            const evidence = await waitForDeepseekBrowserSearchOutcome(
              runtime,
              page,
              startedAtMs,
              setup.env.modelName
            )
            recordWorkbenchAiEvidence(
              runtime,
              {
                modelName: evidence.modelName,
                durationMs: evidence.durationMs,
                events: evidence.events,
                finalAnswerText: evidence.finalAnswerText
              },
              evidence.status === 'completed' ? 0.8 : 0.35,
              evidence.failure
            )

            const toolStarts = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
                event.type === 'tool_call_started'
            )
            const browserStarts = toolStarts.filter((event) => event.toolName === 'browser_use')
            const browserResults = evidence.events.filter(
              (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                event.type === 'tool_call_result' && event.toolName === 'browser_use'
            )
            const browserTexts = browserResults.map(readBrowserUseResultText).filter(Boolean)

            return {
              status: evidence.status,
              failure: evidence.failure,
              finalAnswerText: evidence.finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type),
              browserActions: browserStarts.map((event) => readToolInputString(event, 'action')),
              browserInstructions: browserStarts.map((event) =>
                readToolInputString(event, 'instruction')
              ),
              browserUrls: [
                ...browserStarts.map((event) => readToolInputString(event, 'url')),
                ...browserResults
                  .map((event) => {
                    const data = event.result?.data
                    return isObjectRecord(data) && typeof data.url === 'string' ? data.url : ''
                  })
                  .filter(Boolean)
              ],
              browserResultTexts: browserTexts.slice(-6),
              browserErrors: browserResults.map((event) => event.error || '').filter(Boolean)
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.status === 'completed' &&
              result.eventTypes.includes('run_completed') &&
              result.browserActions.length > 0 &&
              result.browserActions.some((action) => action === 'navigate') &&
              result.browserActions.some((action) => action === 'extract' || action === 'act') &&
              result.browserUrls.some((url) => /baidu|bing|google|sogou|so\.com/i.test(url)) &&
              /deepseek/i.test(result.finalAnswerText) &&
              /融资|投资|估值|fund|financ/i.test(result.finalAnswerText) &&
              result.browserErrors.length === 0,
            {
              name: 'workbench-browser-use-deepseek-financing-search',
              message:
                '真实 e2e 应通过 browser_use 完成搜索页导航/读取，并基于搜索结果回答 DeepSeek 最近融资信息。',
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
