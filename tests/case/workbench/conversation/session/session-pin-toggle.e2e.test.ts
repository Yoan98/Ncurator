import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'session-pin-toggle'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session'],
        description: '验证会话置顶与取消置顶，以及「已置顶」区域显隐。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const session = {
            id: 'pin-toggle-session',
            title: '置顶切换测试会话',
            created_at: Date.now(),
            workspace_id: '',
            pinned: false,
            pinned_at: null as number | null
          }
          session.workspace_id = await page.evaluate(async () => {
            const response = await window.api.workspaceCreate({ name: '置顶测试工作区' })
            if (!response.success || !response.workspace) throw new Error('workspace create failed')
            return response.workspace.id
          })
          await page.evaluate(async (payload) => {
            const response = await window.api.chatSessionSave(payload)
            if (!response.success) throw new Error(response.error || 'chatSessionSave failed')
          }, session)
          await page.reload()
          await navigateToWorkbench(page)

          const sessionItem = getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionItemPrefix}-${session.id}`
          )
          await sessionItem.waitFor({ state: 'visible' })
          const pinButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionPinButtonPrefix}-${session.id}`
          )
          const pinnedSection = getWorkbenchLocator(page, workbenchSelectors.pinnedSessionsSection)

          await sessionItem.hover()
          await pinButton.click({ force: true })
          await pinnedSection.waitFor({ state: 'visible' })
          const pinnedContainsSession = await pinnedSection
            .locator(`[data-testid="${workbenchSelectors.sessionItemPrefix}-${session.id}"]`)
            .isVisible()

          await sessionItem.hover()
          await pinButton.click({ force: true })
          await page
            .locator(`[data-testid="${workbenchSelectors.pinnedSessionsSection}"]`)
            .waitFor({ state: 'detached', timeout: 10_000 })
          const pinnedHiddenAfterUnpin = !(await pinnedSection.isVisible().catch(() => false))
          const sessionVisibleAfterUnpin = await sessionItem.isVisible()

          return {
            pinnedContainsSession,
            pinnedHiddenAfterUnpin,
            sessionVisibleAfterUnpin
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pinnedContainsSession &&
              result.pinnedHiddenAfterUnpin &&
              result.sessionVisibleAfterUnpin,
            {
              name: 'workbench-session-pin-toggle',
              message: '置顶后应出现在「已置顶」；取消后该区域隐藏且会话仍可见。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
