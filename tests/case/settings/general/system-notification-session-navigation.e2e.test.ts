import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { SETTINGS_E2E_TIMEOUT_MS, navigateToSettingsSection } from '../../../harness/e2e/settings'

const CASE_ID = 'system-notification-session-navigation'

describe('settings system notification navigation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'settings',
        suite: 'general',
        description: '点击系统通知后从设置页返回 Workbench，并打开通知对应的会话。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const seeded = await page.evaluate(async () => {
            const sessionId = crypto.randomUUID()
            const title = `通知目标会话 ${crypto.randomUUID().slice(0, 8)}`
            const workspaceResponse = await window.api.workspaceCreate({
              name: `通知测试工作区 ${crypto.randomUUID().slice(0, 8)}`
            })
            const workspaceId = workspaceResponse.workspace?.id
            if (!workspaceResponse.success || !workspaceId) {
              throw new Error(workspaceResponse.error || 'failed to seed notification workspace')
            }
            const sessionResponse = await window.api.chatSessionSave({
              id: sessionId,
              title,
              created_at: Date.now(),
              workspace_id: workspaceId
            })
            if (!sessionResponse.success) {
              throw new Error(sessionResponse.error || 'failed to seed notification session')
            }
            return { sessionId, title }
          })

          await navigateToSettingsSection(page, 'general')
          await runtime.electronApp.evaluate(({ BrowserWindow }, sessionId) => {
            BrowserWindow.getAllWindows()[0]?.webContents.send(
              'system-notification-open-session',
              sessionId
            )
          }, seeded.sessionId)

          await page.waitForFunction(() => window.location.hash === '#/')
          const sessionItem = page.locator(
            `[data-testid="${workbenchSelectors.sessionItemPrefix}-${seeded.sessionId}"]`
          )
          await sessionItem.waitFor({ state: 'visible' })
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.classList.contains('nc-sidebar-item-active'),
            `${workbenchSelectors.sessionItemPrefix}-${seeded.sessionId}`
          )
          return {
            route: await page.evaluate(() => window.location.hash),
            title: (await sessionItem.textContent()) || '',
            active: await sessionItem.evaluate((element) =>
              element.classList.contains('nc-sidebar-item-active')
            ),
            expectedTitle: seeded.title
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.route === '#/' && result.active && result.title.includes(result.expectedTitle),
            {
              name: 'system-notification-opens-target-session',
              message: '系统通知点击事件应返回 Workbench 并打开对应会话。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
