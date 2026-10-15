import { describe, expect, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  createPartnerThroughWorkbenchUi,
  selectWorkbenchResourceMenuItem,
  selectWorkbenchExecutionPermission,
  setWorkbenchInput,
  navigateToWorkbench,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-ui-state-restart-persistence'

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
          const inspectBrowserHistory = async () =>
            runtime.electronApp.evaluate(
              ({ webContents }, url) =>
                webContents
                  .getAllWebContents()
                  .filter((contents) => contents.getURL().startsWith(url))
                  .map((contents) => ({
                    url: contents.getURL(),
                    isLoading: contents.isLoadingMainFrame(),
                    activeIndex: contents.navigationHistory.getActiveIndex(),
                    entries: contents.navigationHistory
                      .getAllEntries()
                      .map(({ url, title }) => ({ url, title }))
                  })),
              server.url
            )
          let { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, '重启恢复伙伴')
          await setWorkbenchInput(page, '重启后仍在的草稿')
          await selectWorkbenchExecutionPermission(page, '完全访问')
          const partner = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === '重启恢复伙伴'
          )
          if (!partner) throw new Error('created partner missing')
          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const tab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          const id = (await tab.getAttribute('data-testid'))?.split('-browser-').at(-1)
          if (!id) throw new Error('browser tab missing')
          const browser = { id }
          const address = getWorkbenchLocator(page, workbenchSelectors.browserPanel).getByRole(
            'textbox',
            { name: '浏览器地址' }
          )
          for (const step of [1, 2]) {
            const url = `${server.url}?step=${step}`
            await address.fill(url)
            await address.press('Enter')
            await page.waitForFunction(
              async ({ tabId, url }) => {
                const { state } = await window.api.browserPanelStateGet({ tabId })
                return state?.url === url && !state.isLoading
              },
              { tabId: id, url }
            )
            await expect
              .poll(
                async () => {
                  const history = await inspectBrowserHistory()
                  return history.some(
                    (item) =>
                      item.url === url &&
                      !item.isLoading &&
                      item.entries.some((entry) => entry.url === `${server.url}?step=1`)
                  )
                },
                { timeout: 15_000 }
              )
              .toBe(true)
          }
          const menuPromise = runtime.electronApp.waitForEvent('window', {
            predicate: async (candidate) =>
              candidate
                .getByRole('link', { name: '放大页面' })
                .waitFor({ state: 'visible', timeout: 5_000 })
                .then(
                  () => true,
                  () => false
                )
          })
          await getWorkbenchLocator(page, workbenchSelectors.browserMenu).click()
          const menu = await menuPromise
          await menu.waitForLoadState('domcontentloaded')
          await menu.getByRole('link', { name: '放大页面' }).click()
          await page.waitForFunction(async (tabId) => {
            const { state } = await window.api.browserPanelStateGet({ tabId })
            return state?.zoomPercent === 110 && state.canGoBack
          }, id)
          await menu.keyboard.press('Escape')
          await page.waitForFunction(async (partnerId) => {
            const { uiState } = await window.api.partnerOpen({ partnerId })
            return (
              uiState?.composer.draft.input === '重启后仍在的草稿' &&
              uiState.composer.executionPermission === 'full_access' &&
              !uiState.panel.collapsed
            )
          }, partner.id)

          const browserHistoryBeforeRestart = await inspectBrowserHistory()
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
          await expect
            .poll(
              async () => {
                const history = await inspectBrowserHistory()
                return history.some(
                  (item) =>
                    item.url === `${server.url}?step=2` &&
                    !item.isLoading &&
                    item.activeIndex > 0 &&
                    item.entries.some((entry) => entry.url === `${server.url}?step=1`)
                )
              },
              { timeout: 15_000 }
            )
            .toBe(true)
          const restoredBrowser = await page.evaluate(
            async ({ tabId, ownerId }) => {
              const tabs = await window.api.browserTabList({ ownerId })
              const state = await window.api.browserPanelStateGet({ tabId })
              return { tabs, state }
            },
            { tabId: browser.id, ownerId: partner.id }
          )
          const browserHistoryAfterRestart = await inspectBrowserHistory()
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
            browserHistoryBeforeRestart,
            browserHistoryAfterRestart,
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
