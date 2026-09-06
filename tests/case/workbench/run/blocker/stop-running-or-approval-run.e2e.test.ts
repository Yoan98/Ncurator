import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  getApprovalCard,
  getWorkbenchLocator,
  createWorkbenchNewSession,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'stop-running-or-approval-run'
const LONG_RUN_PROMPT =
  '请读取当前工作区所有工作目录资料，写一份至少 2000 字的详细分析，逐项说明证据来源。'
const APPROVAL_PROMPT =
  '请使用终端命令在当前工作区创建 stop-approval-waiting.txt，内容写 should-not-execute-before-stop。'

const waitForStopButtonOrRunTerminal = async (input: {
  runtime: Parameters<typeof waitForWorkbenchAiEvent>[0]
  page: Parameters<typeof sendWorkbenchMessage>[0]
  runId: string
}): Promise<'stop' | 'completed' | 'failed' | 'cancelled'> => {
  const deadline = Date.now() + 20_000
  const sendButton = getWorkbenchLocator(input.page, workbenchSelectors.sendButton)
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(input.runtime)
    if (events.some((event) => event.type === 'run_completed' && event.runId === input.runId)) {
      return 'completed'
    }
    if (events.some((event) => event.type === 'run_failed' && event.runId === input.runId)) {
      return 'failed'
    }
    if (events.some((event) => event.type === 'run_cancelled' && event.runId === input.runId)) {
      return 'cancelled'
    }
    const label = (await sendButton.getAttribute('aria-label').catch(() => '')) || ''
    if (label.includes('停止')) return 'stop'
    if (Date.now() >= deadline) {
      throw new Error(`run ${input.runId} did not expose stop state or terminal event`)
    }
    await input.page.waitForTimeout(200)
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
        groups: ['blocker'],
        description: '真实长任务和真实审批等待中点击停止，验证运行结束和 UI 恢复。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          await sendWorkbenchMessage(page, LONG_RUN_PROMPT)
          const longRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'run_started_for_stop',
            matches: (event) => event.type === 'run_started' && event.input === LONG_RUN_PROMPT
          })
          const normalRunState = await waitForStopButtonOrRunTerminal({
            runtime,
            page,
            runId: longRunStarted.runId
          })
          const stopLabelDuringRun =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton)
              .getAttribute('aria-label')
              .catch(() => '')) || ''
          const sessionRunningIndicatorVisible = await page
            .getByLabel('任务运行中')
            .isVisible()
            .catch(() => false)
          if (normalRunState === 'stop') {
            await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
            await waitForWorkbenchAiEvent(runtime, {
              name: 'run_cancelled',
              matches: (event) =>
                event.type === 'run_cancelled' && event.runId === longRunStarted.runId
            })
          }
          const labelAfterCancel =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton)
              .getAttribute('aria-label')
              .catch(() => '')) || ''
          const sessionRunningIndicatorHiddenAfterCancel = !(await page
            .getByLabel('任务运行中')
            .isVisible()
            .catch(() => false))

          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return !(button?.getAttribute('aria-label') || '').includes('停止')
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          await createWorkbenchNewSession(page)
          await sendWorkbenchMessage(page, APPROVAL_PROMPT)
          const approvalRunStarted = await waitForWorkbenchAiEvent(runtime, {
            name: 'approval_run_started',
            matches: (event) => event.type === 'run_started' && event.input === APPROVAL_PROMPT
          })
          await getApprovalCard(page).waitFor({ state: 'visible' })
          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return button?.getAttribute('aria-label')?.includes('停止') ?? false
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          const stopButtonVisibleDuringApproval = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          )
            .isVisible()
            .catch(() => false)
          const stopLabelDuringApproval = stopButtonVisibleDuringApproval
            ? (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
                'aria-label'
              )) || ''
            : ''
          if (stopButtonVisibleDuringApproval) {
            await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
            const approvalCancelled = await waitForWorkbenchAiEvent(runtime, {
              name: 'approval_run_cancelled',
              matches: (event) =>
                event.type === 'run_cancelled' && event.runId === approvalRunStarted.runId
            })
            if (approvalCancelled.type !== 'run_cancelled') {
              throw new Error('approval cancellation did not reach the cancelled state')
            }
          }

          return {
            normalRunState,
            stopLabelDuringRun,
            labelAfterCancel,
            sessionRunningIndicatorVisible,
            sessionRunningIndicatorHiddenAfterCancel,
            stopButtonVisibleDuringApproval,
            stopLabelDuringApproval
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            ['stop', 'completed'].includes(result.normalRunState) &&
              (result.normalRunState === 'completed' ||
                result.stopLabelDuringRun.includes('停止')) &&
              (result.normalRunState === 'completed' ||
                (!result.labelAfterCancel.includes('停止') &&
                  result.sessionRunningIndicatorVisible &&
                  result.sessionRunningIndicatorHiddenAfterCancel)) &&
              result.stopButtonVisibleDuringApproval &&
              result.stopLabelDuringApproval.includes('停止'),
            {
              name: 'workbench-stop-running-and-approval-real',
              message:
                '普通运行中发送按钮应切换为停止并可取消，会话列表同步显示运行标记并在取消后清除；审批等待中也应保留可见停止入口并结束 run。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
