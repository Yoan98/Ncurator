import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'session-delete-confirmation-and-context-ring'
const SESSION_PROMPT = '请只回复 ok，用于删除确认测试会话。'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session', 'composer'],
        description: '验证会话删除确认、取消/确认删除，以及输入框上下文圆圈 hover 信息。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createSession: false
          })
          try {
            await page.getByRole('button', { name: `在 ${setup.workspaceName} 中新建对话` }).click()
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, SESSION_PROMPT)
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.6)
            const sessionTitlePrefix = SESSION_PROMPT.slice(0, 16)
            const selectedSession = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.sessionItemPrefix
            )
              .filter({ hasText: sessionTitlePrefix })
              .first()
            await selectedSession.waitFor({ state: 'visible' })
            const selectedSessionTestId = await selectedSession.getAttribute('data-testid')
            const sessionId = selectedSessionTestId?.replace(
              `${workbenchSelectors.sessionItemPrefix}-`,
              ''
            )
            if (!sessionId || sessionId === selectedSessionTestId) {
              throw new Error('failed to read created session id from UI')
            }

            const contextRing = getWorkbenchLocator(page, workbenchSelectors.contextRing)
            await contextRing.waitFor({ state: 'visible' })
            await page.waitForFunction(
              (testId) => {
                const element = document.querySelector(`[data-testid="${testId}"]`)
                return element?.getAttribute('aria-label')?.includes('已用') || false
              },
              workbenchSelectors.contextRing,
              { timeout: 10_000 }
            )
            const contextRingLabel = (await contextRing.getAttribute('aria-label')) || ''
            await contextRing.hover()
            const contextTooltipVisible = await page
              .getByText('上下文用量')
              .waitFor({ state: 'visible', timeout: 5_000 })
              .then(() => true)
              .catch(() => false)
            const contextTooltipPercentVisible = await page
              .getByText(/已用 \d+%/)
              .first()
              .isVisible()
              .catch(() => false)

            const deleteButton = getWorkbenchLocator(
              page,
              `${workbenchSelectors.sessionDeleteButtonPrefix}-${sessionId}`
            )
            const confirmButton = getWorkbenchLocator(
              page,
              workbenchSelectors.sessionDeleteConfirmButton
            )
            const cancelButton = getWorkbenchLocator(
              page,
              workbenchSelectors.sessionDeleteCancelButton
            )
            await selectedSession.hover()
            await deleteButton.click()
            await confirmButton.waitFor({ state: 'visible' })
            await cancelButton.click()
            await confirmButton.waitFor({ state: 'hidden' })
            const sessionStillExistsAfterCancel = await selectedSession
              .isVisible()
              .catch(() => false)

            await selectedSession.hover()
            await deleteButton.click()
            await confirmButton.waitFor({ state: 'visible' })
            await confirmButton.click()
            await confirmButton.waitFor({ state: 'hidden' })
            const sessionRemovedAfterConfirm = await selectedSession
              .waitFor({ state: 'detached', timeout: 10_000 })
              .then(() => true)
              .catch(async () => !(await selectedSession.isVisible().catch(() => false)))

            return {
              contextRingLabel,
              contextTooltipVisible,
              contextTooltipPercentVisible,
              sessionStillExistsAfterCancel,
              sessionRemovedAfterConfirm,
              finalAnswerText: evidence.finalAnswerText
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.contextRingLabel.includes('已用') &&
              result.contextRingLabel.includes('剩余') &&
              result.contextTooltipVisible &&
              result.contextTooltipPercentVisible &&
              result.sessionStillExistsAfterCancel &&
              result.sessionRemovedAfterConfirm &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-session-delete-confirmation-and-context-ring',
              message:
                'Workbench 会话删除必须先确认，取消不删除，确认后删除；输入框上下文圆圈应可见，hover 后展示已用和剩余比例。',
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
