import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { createRealWorkspaceWithRoot } from '../../../../harness/e2e/settings'

const CASE_ID = 'session-delete-confirmation-and-context-ring'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session', 'composer'],
        description: '验证会话删除确认、删除 loading，以及输入框上下文圆圈 hover 信息。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const workspaceName = `Workbench ${CASE_ID}`
          try {
            const workspaceResponse = await createRealWorkspaceWithRoot(page, {
              name: workspaceName,
              rootPath: workspace.rootPath
            })
            const workspaceId = workspaceResponse.workspace!.id
            const sessionId = await page.evaluate(async (targetWorkspaceId) => {
              const id = crypto.randomUUID()
              const response = await window.api.chatSessionSave({
                id,
                title: '删除确认测试会话',
                created_at: Date.now(),
                workspace_id: targetWorkspaceId
              })
              if (!response.success) {
                throw new Error(response.error || 'failed to create session for delete test')
              }
              return id
            }, workspaceId)
            await page.reload()
            await navigateToWorkbench(page)

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

            const selectedSession = getWorkbenchLocator(
              page,
              `${workbenchSelectors.sessionItemPrefix}-${sessionId}`
            )
            await selectedSession.waitFor({ state: 'visible' })
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

            const deleteDelayInstalled = await page.evaluate(() => {
              type ApiWithDelete = {
                chatSessionDelete: (id: string) => Promise<unknown>
              }
              const target = window as unknown as {
                api: ApiWithDelete
                __restoreWorkbenchDeleteDelay?: () => void
              }
              try {
                const original = target.api.chatSessionDelete
                target.__restoreWorkbenchDeleteDelay = () => {
                  target.api.chatSessionDelete = original
                }
                target.api.chatSessionDelete = async (id: string) => {
                  await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
                  return await original(id)
                }
                return true
              } catch {
                return false
              }
            })

            await selectedSession.hover()
            await deleteButton.click()
            await confirmButton.waitFor({ state: 'visible' })
            await confirmButton.click()
            const deleteLoadingVisible = await confirmButton
              .locator('.ant-btn-loading-icon')
              .waitFor({ state: 'visible', timeout: 1_000 })
              .then(() => true)
              .catch(() => false)
            await confirmButton.waitFor({ state: 'hidden' })
            const sessionRemovedAfterConfirm = await selectedSession
              .waitFor({ state: 'detached', timeout: 10_000 })
              .then(() => true)
              .catch(async () => !(await selectedSession.isVisible().catch(() => false)))

            await page.evaluate(() => {
              const target = window as unknown as {
                __restoreWorkbenchDeleteDelay?: () => void
              }
              target.__restoreWorkbenchDeleteDelay?.()
            })

            return {
              contextRingLabel,
              contextTooltipVisible,
              contextTooltipPercentVisible,
              sessionStillExistsAfterCancel,
              deleteDelayInstalled,
              deleteLoadingVisible,
              sessionRemovedAfterConfirm
            }
          } finally {
            await page
              .evaluate(() => {
                const target = window as unknown as {
                  __restoreWorkbenchDeleteDelay?: () => void
                }
                target.__restoreWorkbenchDeleteDelay?.()
              })
              .catch(() => undefined)
            await workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.contextRingLabel.includes('已用') &&
              result.contextRingLabel.includes('剩余') &&
              result.contextTooltipVisible &&
              result.contextTooltipPercentVisible &&
              result.sessionStillExistsAfterCancel &&
              result.deleteDelayInstalled &&
              result.deleteLoadingVisible &&
              result.sessionRemovedAfterConfirm,
            {
              name: 'workbench-session-delete-confirmation-and-context-ring',
              message:
                'Workbench 会话删除必须先确认，确认后展示 loading 并删除；输入框上下文圆圈应可见，hover 后展示已用和剩余比例。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
})
