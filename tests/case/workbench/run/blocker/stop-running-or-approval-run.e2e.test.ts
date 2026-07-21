import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getApprovalCard,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'stop-running-or-approval-run'

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
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          await sendWorkbenchMessage(
            page,
            '请读取当前工作区所有工作目录资料，写一份至少 2000 字的详细分析，逐项说明证据来源。'
          )
          await waitForWorkbenchAiEvent(runtime, {
            name: 'run_started_for_stop',
            matches: (event) => event.type === 'run_started'
          })
          await getWorkbenchLocator(page, workbenchSelectors.sendButton).waitFor({
            state: 'visible'
          })
          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return button?.getAttribute('aria-label')?.includes('停止') ?? false
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          const stopLabelDuringRun =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
              'aria-label'
            )) || ''
          await page.getByLabel('任务运行中').waitFor({ state: 'visible' })
          const sessionRunningIndicatorVisible = await page.getByLabel('任务运行中').isVisible()
          await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'run_cancelled',
            matches: (event) => event.type === 'run_cancelled'
          })
          await page.waitForFunction(
            (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`)
              return !(button?.getAttribute('aria-label') || '').includes('停止')
            },
            workbenchSelectors.sendButton,
            { timeout: 10_000 }
          )
          const labelAfterCancel =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
              'aria-label'
            )) || ''
          await page.getByLabel('任务运行中').waitFor({ state: 'hidden' })
          const sessionRunningIndicatorHiddenAfterCancel = !(await page
            .getByLabel('任务运行中')
            .isVisible()
            .catch(() => false))

          await sendWorkbenchMessage(
            page,
            '请使用终端命令在当前工作区创建 stop-approval-waiting.txt，内容写 should-not-execute-before-stop。'
          )
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
            await waitForWorkbenchAiEvent(runtime, {
              name: 'approval_run_cancelled',
              matches: (event) => event.type === 'run_cancelled'
            })
          }

          return {
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
            result.stopLabelDuringRun.includes('停止') &&
              !result.labelAfterCancel.includes('停止') &&
              result.sessionRunningIndicatorVisible &&
              result.sessionRunningIndicatorHiddenAfterCancel &&
              result.stopButtonVisibleDuringApproval &&
              result.stopLabelDuringApproval.includes('停止'),
            {
              name: 'workbench-stop-running-and-approval-real',
              message:
                '普通运行中发送按钮应切换为停止并可取消，会话列表同步显示运行标记并在取消后清除；审批等待中也应保留可见停止入口并结束 run。',
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
