import { describe, it } from 'vitest'
import type { ChatSessionUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'session-ui-state-restart-persistence'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session'],
        description: '验证正常重启后恢复最后会话、输入、右侧浏览器 URL、历史和缩放。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const server = await startLocalWorkbenchHttpServer(
            '<html><body>restart state</body></html>'
          )
          runtime.registerResource({
            name: 'session-ui-restart-server',
            phase: 'after-app-close',
            dispose: server.close
          })
          let { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const session = {
            id: 'restart-ui-session',
            title: '重启恢复会话',
            created_at: Date.now(),
            workspace_id: ''
          }
          session.workspace_id = await page.evaluate(async () => {
            const response = await window.api.workspaceCreate({ name: '会话重启恢复工作区' })
            if (!response.success || !response.workspace) throw new Error('workspace create failed')
            return response.workspace.id
          })
          const browser = await page.evaluate(
            async ({ session, firstUrl, secondUrl }) => {
              await window.api.chatSessionSave(session)
              const created = await window.api.browserTabCreate({ ownerId: session.id })
              if (!created.success || !created.state) throw new Error('browser tab create failed')
              await window.api.browserTabNavigate({ tabId: created.state.id, url: firstUrl })
              await window.api.browserTabNavigate({ tabId: created.state.id, url: secondUrl })
              await window.api.browserPanelZoomIn({ tabId: created.state.id })
              const state: ChatSessionUiStateV1 = {
                version: 1,
                composer: {
                  mode: 'ai',
                  aiPreference: 'local_sources_relaxed',
                  executionPermission: 'full_access',
                  modelSelection: { mainModel: null },
                  workspaceId: null,
                  draft: {
                    input: '重启后仍在的草稿',
                    contentNodes: [{ kind: 'text', text: '重启后仍在的草稿' }],
                    selectedReferences: [],
                    attachments: [],
                    assetBucketId: null
                  }
                },
                panel: {
                  tabs: [
                    {
                      id: `browser:${created.state.id}`,
                      kind: 'browser',
                      title: '重启浏览器',
                      browserTabId: created.state.id,
                      state: {
                        kind: 'browser',
                        title: '重启浏览器',
                        browserTabId: created.state.id
                      }
                    }
                  ],
                  activeTabId: `browser:${created.state.id}`,
                  collapsed: false,
                  fallbackState: { kind: 'empty', title: '资源工作台', description: '' }
                }
              }
              await window.api.chatSessionUiStateSave({ sessionId: session.id, state })
              await window.api.workbenchUiStateSave({ activeViewKey: session.id, draftState: null })
              return created.state
            },
            {
              session,
              firstUrl: `${server.url}?step=1`,
              secondUrl: `${server.url}?step=2`
            }
          )
          await page.reload()
          await navigateToWorkbench(page)
          await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })

          const restarted = await runtime.restartApp()
          page = restarted.page
          await navigateToWorkbench(page)
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ===
              '重启后仍在的草稿',
            workbenchSelectors.input
          )
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          await page.waitForFunction(
            async (tabId) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success && response.state?.canGoBack === true
            },
            browser.id,
            { timeout: 10_000 }
          )
          const restoredBrowser = await page.evaluate(async (tabId) => {
            const tabs = await window.api.browserTabList({ ownerId: 'restart-ui-session' })
            const state = await window.api.browserPanelStateGet({ tabId })
            return { tabs, state }
          }, browser.id)
          const input = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()
          const sessionVisible = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionItemPrefix}-${session.id}`
          ).isVisible()
          const executionPermission = (
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.executionPermissionSwitch
            ).textContent()) || ''
          ).trim()
          return {
            input,
            sessionVisible,
            executionPermission,
            restoredBrowser,
            expectedUrl: `${server.url}?step=2`
          }
        },
        assert: async (result, runtime) => {
          const restored = result.restoredBrowser.tabs.tabs[0]
          await runtime.assertThat(
            result.sessionVisible &&
              result.input === '重启后仍在的草稿' &&
              result.executionPermission.includes('完全访问') &&
              result.restoredBrowser.tabs.success &&
              restored?.url === result.expectedUrl &&
              restored.zoomPercent === 110 &&
              result.restoredBrowser.state.success &&
              result.restoredBrowser.state.state?.canGoBack === true,
            {
              name: 'workbench-session-ui-state-restart-persistence',
              message: '正常重启必须恢复最后会话、草稿和浏览器 URL、历史、缩放。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 2
  )
})
