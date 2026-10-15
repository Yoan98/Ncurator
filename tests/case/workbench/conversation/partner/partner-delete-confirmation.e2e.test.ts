import { describe, it } from 'vitest'
import path from 'node:path'
import { resolveRunArtifactsDir } from '../../../../harness/core/write-run-log'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { nativeConfirmationCoversOwner } from '../../../../harness/e2e/nativeConfirm'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  dismissWorkbenchPartnerDeleteConfirmation,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  openWorkbenchPartnerDeleteConfirmation,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-delete-confirmation'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证原生删除确认覆盖内置浏览器，取消不影响网页运行，确认后删除伙伴。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            configureModel: false
          })
          const selectedPartner = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.partnerItemPrefix
          )
            .filter({ hasText: setup.workspaceName })
            .first()
          await selectedPartner.waitFor({ state: 'visible' })
          const selectedPartnerTestId = await selectedPartner.getAttribute('data-testid')
          const partnerId = selectedPartnerTestId?.replace(
            `${workbenchSelectors.partnerItemPrefix}-`,
            ''
          )
          if (!partnerId || partnerId === selectedPartnerTestId) {
            throw new Error('failed to read created partner id from UI')
          }

          let heartbeat = 0
          const server = await startLocalWorkbenchHttpServer(
            `<!doctype html><html><head><title>Delete confirmation browser</title></head>
              <body style="background:#e3f0ff">BROWSER REMAINS LIVE
                <script>setInterval(() => fetch('/heartbeat').catch(() => {}), 50)</script>
              </body></html>`,
            {
              onRequest: (url) => {
                if (url !== '/heartbeat') return false
                heartbeat += 1
                return true
              }
            }
          )
          runtime.registerResource({
            name: 'delete-confirmation-browser-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const address = browserPanel.getByRole('textbox', { name: /浏览器地址/u })
          await address.fill(server.url)
          await address.press('Enter')
          const browserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          const browserTabId = (await browserTab.getAttribute('data-testid'))
            ?.split('-browser-')
            .at(-1)
          if (!browserTabId) throw new Error('browser tab id is missing')
          await page.waitForFunction(async (tabId) => {
            const response = await window.api.browserPanelStateGet({ tabId })
            return response.success && response.state?.title === 'Delete confirmation browser'
          }, browserTabId)
          await page.waitForTimeout(300)
          const mainWindow = await runtime.electronApp.browserWindow(page)
          const mainWindowId = await mainWindow.evaluate((window) => window.id)
          const inspectNativeViews = async () =>
            runtime.electronApp.evaluate(
              ({ BrowserWindow, WebContentsView }, { mainWindowId, url }) => {
                const owner = BrowserWindow.fromId(mainWindowId)
                const browser = owner?.contentView.children.find(
                  (view): view is Electron.WebContentsView =>
                    view instanceof WebContentsView && view.webContents.getURL() === url
                )
                return {
                  browserId: browser?.webContents.id || null,
                  browserVisible: browser?.getVisible() || false,
                  browserBounds: browser?.getBounds() || null,
                  popups:
                    owner?.getChildWindows().map((popup) => ({
                      parentId: popup.getParentWindow()?.id,
                      visible: popup.isVisible(),
                      bounds: popup.getBounds()
                    })) || [],
                  ownerBounds: owner?.getContentBounds() || null
                }
              },
              { mainWindowId, url: server.url }
            )
          const before = await inspectNativeViews()
          if (!before.browserId || !before.browserVisible)
            throw new Error('browser is not presented')
          const cancellations = []
          for (const action of ['close', 'cancel', 'escape', 'mask'] as const) {
            const popup = await openWorkbenchPartnerDeleteConfirmation(runtime, partnerId)
            const during = await inspectNativeViews()
            if (action === 'close') {
              const screenshotPath = path.join(
                resolveRunArtifactsDir({
                  scope: 'workbench/conversation/partner',
                  caseId: CASE_ID,
                  runId: runtime.runId
                }),
                'native-delete-confirmation.png'
              )
              await popup.screenshot({ path: screenshotPath })
              await runtime.captureArtifact({
                kind: 'screenshot',
                relativePath: 'native-delete-confirmation.png',
                message: '原生伙伴删除确认弹窗'
              })
            }
            const heartbeatBefore = heartbeat
            await page.waitForTimeout(250)
            const heartbeatContinues = heartbeat > heartbeatBefore
            await dismissWorkbenchPartnerDeleteConfirmation(popup, action)
            const after = await inspectNativeViews()
            cancellations.push({
              action,
              popupCoversOwner:
                during.popups.length === 1 &&
                during.popups[0].visible &&
                during.popups[0].parentId === mainWindowId &&
                nativeConfirmationCoversOwner(during.popups[0].bounds, during.ownerBounds),
              popupBounds: during.popups[0]?.bounds,
              ownerBounds: during.ownerBounds,
              browserPreserved:
                during.browserId === before.browserId &&
                during.browserVisible &&
                after.browserId === before.browserId &&
                after.browserVisible &&
                JSON.stringify(during.browserBounds) === JSON.stringify(before.browserBounds) &&
                JSON.stringify(after.browserBounds) === JSON.stringify(before.browserBounds),
              heartbeatContinues,
              popupDestroyed: after.popups.length === 0,
              partnerPreserved: await selectedPartner.isVisible()
            })
          }
          const confirmation = await openWorkbenchPartnerDeleteConfirmation(runtime, partnerId)
          await dismissWorkbenchPartnerDeleteConfirmation(confirmation, 'confirm')
          const partnerRemovedAfterConfirm = await selectedPartner
            .waitFor({ state: 'detached', timeout: 10_000 })
            .then(() => true)
            .catch(async () => !(await selectedPartner.isVisible().catch(() => false)))

          const afterDeletion = await inspectNativeViews()
          return { cancellations, partnerRemovedAfterConfirm, afterDeletion }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.cancellations.every(
              (item) =>
                item.popupCoversOwner &&
                item.browserPreserved &&
                item.heartbeatContinues &&
                item.popupDestroyed &&
                item.partnerPreserved
            ) &&
              result.partnerRemovedAfterConfirm &&
              result.afterDeletion.browserId === null &&
              result.afterDeletion.popups.length === 0,
            {
              name: 'workbench-partner-delete-confirmation',
              message:
                '删除确认必须覆盖浏览器且不打断网页；关闭与取消不删除，确认后删除并清理视图。',
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
