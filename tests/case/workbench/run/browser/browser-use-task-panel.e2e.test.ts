import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  type WorkbenchAiCompletionEvidence,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-use-task-panel'
const TASK_CODE = 'cedar-browser-731'
const BROWSER_PANEL_WAIT_TIMEOUT_MS = 180_000
const BROWSER_TASK_COMPLETION_TIMEOUT_MS = 240_000
const BROWSER_USE_FAILURE_LIMIT = 2

const readBrowserUseResultText = (event: Extract<AiRunEvent, { type: 'tool_call_result' }>): string => {
  const data = event.result?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const parts: string[] = []
  for (const key of ['content', 'pageState', 'summary', 'message']) {
    const value = (data as Record<string, unknown>)[key]
    if (typeof value === 'string') parts.push(value)
  }
  return parts.join('\n')
}

const isApprovalBatchRequiredEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

const waitForBrowserPanelOpenedWithApproval = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
): Promise<void> => {
  const handledBatchIds = new Set<string>()
  const deadline = Date.now() + BROWSER_PANEL_WAIT_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for browser panel: ${failed.error}`)
    }
    if (events.some((event) => event.type === 'browser_panel_opened')) return

    const approvalRequired = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
          isApprovalBatchRequiredEvent(event) && !handledBatchIds.has(event.batchId)
      )
      .at(-1)
    if (approvalRequired) {
      handledBatchIds.add(approvalRequired.batchId)
      await decideWorkbenchApprovalBatch(runtime, runtime.page, {
        event: approvalRequired,
        action: 'approve'
      })
      continue
    }

    if (Date.now() >= deadline) {
      throw new Error('browser panel did not open before timeout')
    }
    await runtime.page.waitForTimeout(500)
  }
}

const waitForBrowserTaskCompletion = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  startedAtMs: number,
  modelName: string
): Promise<WorkbenchAiCompletionEvidence> => {
  const deadline = Date.now() + BROWSER_TASK_COMPLETION_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for browser task: ${failed.error}`)
    }

    const browserUseFailures = events.filter(
      (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
        event.type === 'tool_call_result' &&
        event.toolName === 'browser_use' &&
        (Boolean(event.error) || event.result?.ok === false)
    )
    if (browserUseFailures.length >= BROWSER_USE_FAILURE_LIMIT) {
      const latestFailure = browserUseFailures.at(-1)
      runtime.signal({
        name: 'workbench-browser-use-repeated-failure',
        status: 'failed',
        message: 'browser_use 连续失败，停止等待模型重复重试。',
        data: {
          failureCount: browserUseFailures.length,
          latestFailure: latestFailure
            ? {
                toolCallId: latestFailure.toolCallId,
                error: latestFailure.error || '',
                result: latestFailure.result || null
              }
            : null
        }
      })
      throw new Error(
        `browser_use failed ${browserUseFailures.length} times; latest=${JSON.stringify(
          latestFailure?.result || latestFailure?.error || null
        )}`
      )
    }

    const runCompleted = events.find((event) => event.type === 'run_completed')
    const browserTaskDoneText = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
          event.type === 'tool_call_result' && event.toolName === 'browser_use'
      )
      .map(readBrowserUseResultText)
      .find((text) => text.includes('BROWSER_TASK_DONE') && text.includes(TASK_CODE))
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
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText
      }
    }
    if (browserTaskDoneText) {
      const finalAnswerText =
        events
          .filter(
            (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
              event.type === 'answer_completed'
          )
          .map((event) => event.text)
          .at(-1) || browserTaskDoneText
      return {
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText
      }
    }

    if (Date.now() >= deadline) {
      throw new Error('browser task did not complete before timeout')
    }
    await runtime.page.waitForTimeout(500)
  }
}

describe('workbench run e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['browser'],
      description: '真实 AI 使用 browser_use 操作本地网页，验证右侧浏览器面板、网页结果和最终回答闭环。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const server = await startLocalWorkbenchHttpServer(`<!doctype html>
          <title>Workbench Browser Task</title>
          <label>任务口令 <input id="task-code" aria-label="任务口令" /></label>
          <button id="submit-task">提交任务</button>
          <output id="task-result">等待提交</output>
          <script>
            document.querySelector('#submit-task').addEventListener('click', () => {
              document.querySelector('#task-result').textContent = 'BROWSER_TASK_DONE:' + document.querySelector('#task-code').value
            })
          </script>`)
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请使用右侧内置浏览器打开 ${server.url}，在“任务口令”输入框填入 ${TASK_CODE}，点击“提交任务”，然后告诉我页面显示的完整结果。不要只抓取源码，必须实际操作页面。`
          )

          await waitForBrowserPanelOpenedWithApproval(runtime)
          await getWorkbenchLocator(page, workbenchSelectors.browserPanel).waitFor({
            state: 'visible'
          })
          await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({
            state: 'visible'
          })
          const evidence = await waitForBrowserTaskCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          return {
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type),
            usedBrowserTool: evidence.events.some(
              (event) => event.type === 'tool_call_result' && event.toolName === 'browser_use'
            )
          }
        } finally {
          await setup.workspace.cleanup()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.eventTypes.includes('browser_panel_opened') &&
            result.usedBrowserTool &&
            /BROWSER_TASK_DONE/u.test(result.finalAnswerText) &&
            result.finalAnswerText.includes(TASK_CODE),
          {
            name: 'workbench-browser-use-panel-real',
            message:
              '真实 browser_use 任务应打开右侧内置浏览器、操作本地网页并在最终回答中回收网页操作结果，对齐 WB-PANEL-004-AC1 至 WB-PANEL-004-AC4、WB-CORE-005、WB-CORE-006。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
