import { describe, it } from 'vitest'
import type { Partner, PartnerUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-ui-state-restart-persistence'

const createPartner = (id: string, name: string): Partner => {
  const now = Date.now()
  return {
    id,
    name,
    avatar_shape: 'circle',
    avatar_color: 'blue',
    created_at: now,
    updated_at: now,
    last_viewed_at: now,
    pinned: false,
    pinned_at: null
  }
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证正常重启后恢复最后伙伴、输入、右侧浏览器 URL、历史和缩放。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const server = await startLocalWorkbenchHttpServer(
            '<html><body>restart state</body></html>'
          )
          runtime.registerResource({
            name: 'partner-ui-restart-server',
            phase: 'after-app-close',
            dispose: server.close
          })
          let { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const partner = createPartner('restart-ui-partner', '重启恢复伙伴')
          const browser = await page.evaluate(
            async ({ partner, firstUrl, secondUrl }) => {
              const waitForBrowserState = async (
                tabId: string,
                predicate: (state: NonNullable<
                  Awaited<ReturnType<typeof window.api.browserPanelStateGet>>['state']
                >) => boolean,
                label: string
              ): Promise<void> => {
                const deadline = Date.now() + 10_000
                for (;;) {
                  const state = await window.api.browserPanelStateGet({ tabId })
                  if (state.success && state.state && predicate(state.state)) return
                  if (Date.now() >= deadline) {
                    throw new Error(`${label}: ${JSON.stringify(state.state || null)}`)
                  }
                  await new Promise<void>((resolve) => setTimeout(resolve, 100))
                }
              }

              await window.api.partnerSave(partner)
              const created = await window.api.browserTabCreate({ ownerId: partner.id })
              if (!created.success || !created.state) throw new Error('browser tab create failed')
              await window.api.browserTabNavigate({ tabId: created.state.id, url: firstUrl })
              await waitForBrowserState(
                created.state.id,
                (state) => state.url === firstUrl && state.isLoading === false,
                'first navigate not ready'
              )
              await window.api.browserTabNavigate({ tabId: created.state.id, url: secondUrl })
              await waitForBrowserState(
                created.state.id,
                (state) =>
                  state.url === secondUrl && state.isLoading === false && state.canGoBack === true,
                'second navigate not ready'
              )
              const zoomed = await window.api.browserPanelZoomIn({ tabId: created.state.id })
              if (!zoomed.success || !zoomed.state) throw new Error('browser zoom in failed')
              await waitForBrowserState(
                created.state.id,
                (state) =>
                  state.canGoBack === true &&
                  state.zoomPercent === 110 &&
                  state.url === secondUrl,
                'browser state not ready before restart'
              )
              const state: PartnerUiStateV1 = {
                version: 1,
                composer: {
                  aiPreference: 'local_sources_relaxed',
                  executionPermission: 'full_access',
                  modelSelection: { mainModel: null },
                  draft: {
      formatVersion: 2,
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
              await window.api.partnerUiStateSave({ partnerId: partner.id, state })
              await window.api.workbenchUiStateSave({ activeViewKey: partner.id })
              return created.state
            },
            {
              partner,
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
            async ({ tabId, expectedUrl }) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return (
                response.success &&
                response.state?.canGoBack === true &&
                response.state.zoomPercent === 110 &&
                response.state.url === expectedUrl
              )
            },
            { tabId: browser.id, expectedUrl: `${server.url}?step=2` },
            { timeout: 15_000 }
          )
          const restoredBrowser = await page.evaluate(async (tabId) => {
            const tabs = await window.api.browserTabList({ ownerId: 'restart-ui-partner' })
            const state = await window.api.browserPanelStateGet({ tabId })
            return { tabs, state }
          }, browser.id)
          const input = (
            (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
          ).trim()
          const partnerVisible = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).isVisible()
          const executionPermission = (
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.executionPermissionSwitch
            ).textContent()) || ''
          ).trim()
          return {
            input,
            partnerVisible,
            executionPermission,
            restoredBrowser,
            expectedUrl: `${server.url}?step=2`
          }
        },
        assert: async (result, runtime) => {
          const restored = result.restoredBrowser.tabs.tabs[0]
          await runtime.assertThat(
            result.partnerVisible &&
              result.input === '重启后仍在的草稿' &&
              result.executionPermission.includes('完全访问') &&
              result.restoredBrowser.tabs.success &&
              restored?.url === result.expectedUrl &&
              restored.zoomPercent === 110 &&
              result.restoredBrowser.state.success &&
              result.restoredBrowser.state.state?.canGoBack === true,
            {
              name: 'workbench-partner-ui-state-restart-persistence',
              message: '正常重启必须恢复最后伙伴、草稿和浏览器 URL、历史、缩放。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 2
  )
})
