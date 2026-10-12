import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  createPartnerThroughWorkbenchUi,
  selectWorkbenchResourceMenuItem,
  startLocalWorkbenchHttpServer,
  setWorkbenchInput,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'background-partner-ui-event-isolation'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证后台 A 伙伴的浏览器状态变化不会覆盖当前 B 伙伴。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          let releaseResponse = (): void => {}
          const responseGate = new Promise<void>((resolve) => {
            releaseResponse = resolve
          })
          const server = await startLocalWorkbenchHttpServer(
            '<html><title>A 完成加载</title><body>A 的页面</body></html>',
            {
              beforeResponse: () => responseGate
            }
          )
          runtime.registerResource({
            name: 'background-navigation-server',
            phase: 'before-app-close',
            dispose: async () => {
              releaseResponse()
              await server.close()
            }
          })
          await createPartnerThroughWorkbenchUi(page, '当前 B')
          await setWorkbenchInput(page, 'B 当前草稿')
          await createPartnerThroughWorkbenchUi(page, '后台 A')
          await setWorkbenchInput(page, 'A 后台草稿')
          const partners = await page.evaluate(() => window.api.partnerList())
          const partnerA = partners.find((item) => item.name === '后台 A')
          const partnerB = partners.find((item) => item.name === '当前 B')
          if (!partnerA || !partnerB) throw new Error('created partners missing')
          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const tab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          const tabId = (await tab.getAttribute('data-testid'))?.split('-browser-').at(-1)
          if (!tabId) throw new Error('browser tab missing')
          const address = getWorkbenchLocator(page, workbenchSelectors.browserPanel).getByRole(
            'textbox',
            { name: '浏览器地址' }
          )
          await address.fill(server.url)
          await address.press('Enter')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerB.id}`
          ).click()
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent === 'B 当前草稿',
            workbenchSelectors.input
          )
          releaseResponse()
          await page.waitForFunction(
            async ({ tabId, url }) => {
              const { state } = await window.api.browserPanelStateGet({ tabId })
              return state?.url === url && !state.isLoading
            },
            { tabId, url: server.url }
          )
          const browser = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            tabId
          )
          const currentAfterBackgroundEvent = {
            input: (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim(),
            panelVisible: await page.evaluate(
              (testId) =>
                document
                  .querySelector(`[data-testid="${testId}"]`)
                  ?.getAttribute('data-panel-visible') === 'true',
              workbenchSelectors.contentPanelShell
            )
          }
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerA.id}`
          ).click()
          await page.waitForFunction(
            ({ testId, draft }) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
            { testId: workbenchSelectors.input, draft: 'A 后台草稿' }
          )
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          const aTabVisible = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.resourceTabPrefix}-browser-${tabId}`
          ).isVisible()
          const listedAfterSwitch = await page.evaluate(
            (ownerId) => window.api.browserTabList({ ownerId }),
            partnerA.id
          )
          return { currentAfterBackgroundEvent, browser, listedAfterSwitch, aTabVisible }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.currentAfterBackgroundEvent.input === 'B 当前草稿' &&
              !result.currentAfterBackgroundEvent.panelVisible &&
              result.browser.success &&
              result.listedAfterSwitch.tabs.some(
                (tab) => tab.id === result.browser.state?.id && tab.url === result.browser.state.url
              ) &&
              result.aTabVisible,
            {
              name: 'workbench-background-partner-ui-event-isolation',
              message: 'A 的后台浏览器状态只能归属 A，不能展开或覆盖当前 B。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
