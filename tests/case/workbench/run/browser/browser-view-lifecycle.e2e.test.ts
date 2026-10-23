import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  createWorkbenchNewSession,
  dismissWorkbenchPartnerDeleteConfirmation,
  getWorkbenchLocator,
  openWorkbenchPartnerDeleteConfirmation,
  sendWorkbenchMessage,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-view-lifecycle'
const WORKSPACE_NAME = 'Browser Lifecycle Workspace'
const SESSION_PROMPT = 'Reply with BROWSER_SESSION_READY only. Do not use tools.'

type ViewportRect = {
  x: number
  y: number
  width: number
  height: number
}

const sameSize = (left: ViewportRect | null, right: ViewportRect | null): boolean =>
  left !== null &&
  right !== null &&
  Math.abs(left.width - right.width) < 1 &&
  Math.abs(left.height - right.height) < 1

const sameRect = (left: ViewportRect | null, right: ViewportRect | null): boolean =>
  sameSize(left, right) &&
  left !== null &&
  right !== null &&
  Math.abs(left.x - right.x) < 1 &&
  Math.abs(left.y - right.y) < 1

const isUsableViewport = (rect: ViewportRect | null): rect is ViewportRect =>
  rect !== null && rect.width > 100 && rect.height > 100

const waitForHeartbeatCount = async (
  readCount: () => number,
  minimum: number,
  timeoutMs = 5_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (readCount() < minimum) {
    if (Date.now() >= deadline) {
      throw new Error(`browser lifecycle heartbeat did not reach ${String(minimum)}`)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
}

describe('workbench browser lifecycle e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description:
          '使用真实窗口像素验证浏览器初次显示、折叠恢复、原生菜单覆盖和会话切换期间持续运行。',
        fixtures: ['tests/fixtures/workspace'],
        knowledge: 'cached',
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let heartbeatCount = 0
          let releaseBackgroundResponse = (): void => {}
          const backgroundResponseGate = new Promise<void>((resolve) => {
            releaseBackgroundResponse = resolve
          })
          const checkpoint = (name: string): void => {
            runtime.signal({ name: `browser-lifecycle-${name}`, message: name })
          }
          const server = await startLocalWorkbenchHttpServer(
            `<!doctype html>
            <html>
              <head>
                <title>Browser lifecycle fixture</title>
                <style>
                  html, body { width: 100%; min-height: 1800px; margin: 0; background: #101820; color: #ffffff; }
                  body { display: grid; place-items: center; font: 700 36px system-ui; }
                  main { width: 72%; padding: 48px; background: #d7263d; border: 20px solid #20bf55; }
                </style>
              </head>
              <body>
                <main>BROWSER VIEW IS LIVE <input aria-label="lifecycle field" /></main>
                <script>
                  window.lifecycleTick = 0
                  setInterval(() => {
                    window.lifecycleTick += 1
                    void fetch('/__ncurator-browser-lifecycle-heartbeat').catch(() => undefined)
                  }, 50)
                </script>
              </body>
            </html>`,
            {
              beforeResponse: async (requestUrl) => {
                if (requestUrl.includes('background=1')) await backgroundResponseGate
              },
              onRequest: (requestUrl) => {
                if (!requestUrl.startsWith('/__ncurator-browser-lifecycle-heartbeat')) {
                  return false
                }
                heartbeatCount += 1
                return true
              }
            }
          )
          runtime.registerResource({
            name: 'browser-lifecycle-http-server',
            phase: 'before-app-close',
            dispose: async () => {
              releaseBackgroundResponse()
              await server.close()
            }
          })

          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: WORKSPACE_NAME
          })
          const liveEnv = setup.env
          const sessionStartedAt = Date.now()
          await sendWorkbenchMessage(page, SESSION_PROMPT)
          await waitForWorkbenchAiRunCompletion(
            runtime,
            sessionStartedAt,
            liveEnv.modelName,
            240_000,
            { page }
          )
          checkpoint('session-ready')
          const originalSessionTestId = await page
            .locator(
              `[data-testid^="${workbenchSelectors.sessionItemPrefix}-"].nc-sidebar-item-active`
            )
            .getAttribute('data-testid')
          if (!originalSessionTestId) throw new Error('active session id is missing')
          const originalSessionItem = page.getByTestId(originalSessionTestId)
          await originalSessionItem.waitFor({ state: 'visible' })

          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
          }, workbenchSelectors.contentPanelShell)
          checkpoint('panel-visible')

          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const browserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          await browserTab.waitFor({ state: 'visible' })
          const browserTabTestId = await browserTab.getAttribute('data-testid')
          const browserTabId = browserTabTestId?.split('-browser-').at(-1) || ''
          if (!browserTabId) throw new Error('browser tab id is missing')

          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const addressInput = browserPanel.getByRole('textbox', { name: /浏览器地址/u })
          const goButton = browserPanel.getByRole('button', { name: /前往/u })
          const emptyGoDisabled = await goButton.isDisabled()
          const enterUrl = `${server.url}?enter=1`
          await addressInput.fill(enterUrl)
          await addressInput.press('Enter')
          await page.waitForFunction(
            async ({ tabId, url }) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success && response.state?.url === url && !response.state.isLoading
            },
            { tabId: browserTabId, url: enterUrl }
          )
          await addressInput.fill(server.url)
          await goButton.click()
          await page.waitForFunction(
            async ({ tabId, url }) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success && response.state?.url === url && !response.state.isLoading
            },
            { tabId: browserTabId, url: server.url }
          )
          checkpoint('browser-loaded')

          const viewport = getWorkbenchLocator(page, workbenchSelectors.browserViewport)
          const readViewportRect = async (): Promise<ViewportRect | null> => {
            const box = await viewport.boundingBox()
            return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
          }
          const waitForStableViewportRect = async (): Promise<ViewportRect> => {
            const deadline = Date.now() + 5_000
            let previous: ViewportRect | null = null
            let stableSamples = 0
            while (Date.now() < deadline) {
              const current = await readViewportRect()
              stableSamples = sameRect(previous, current) ? stableSamples + 1 : 0
              if (current && stableSamples >= 3) return current
              previous = current
              await page.waitForTimeout(100)
            }
            throw new Error('browser viewport layout did not stabilize')
          }
          const captureViewportPixels = async (options?: { requireDomViewport?: boolean }) => {
            if (options?.requireDomViewport !== false) {
              const rect = await readViewportRect()
              if (!rect) throw new Error('browser viewport bounds are missing')
            }
            return await runtime.electronApp.evaluate(async ({ webContents }, url) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().startsWith(url))
              if (!contents || contents.isDestroyed()) {
                throw new Error('embedded browser web contents is unavailable')
              }
              const image = await contents.capturePage()
              const size = image.getSize()
              const bitmap = image.toBitmap()
              let sampled = 0
              let white = 0
              let dark = 0
              for (let y = 0; y < size.height; y += 3) {
                for (let x = 0; x < size.width; x += 3) {
                  const offset = (y * size.width + x) * 4
                  const blue = bitmap[offset]
                  const green = bitmap[offset + 1]
                  const red = bitmap[offset + 2]
                  sampled += 1
                  if (red > 245 && green > 245 && blue > 245) white += 1
                  if (red < 80 && green < 100 && blue < 120) dark += 1
                }
              }
              return {
                sampled,
                whiteRatio: sampled > 0 ? white / sampled : 1,
                darkRatio: sampled > 0 ? dark / sampled : 0,
                imageSize: size
              }
            }, server.url)
          }
          const waitForBrowserContentPixels = async (): Promise<
            Awaited<ReturnType<typeof captureViewportPixels>>
          > => {
            const deadline = Date.now() + 8_000
            let lastSample: Awaited<ReturnType<typeof captureViewportPixels>> | null = null
            while (Date.now() < deadline) {
              const sample = await captureViewportPixels()
              lastSample = sample
              if (sample.sampled > 1_000 && sample.whiteRatio < 0.2 && sample.darkRatio > 0.15) {
                return sample
              }
              await page.waitForTimeout(200)
            }
            throw new Error(
              `browser content pixels did not restore, last sample: ${JSON.stringify(lastSample)}`
            )
          }
          const readNativeChildCount = async (): Promise<number> =>
            await runtime.electronApp.evaluate(({ BrowserWindow }) => {
              const mainWindow = BrowserWindow.getAllWindows().find(
                (candidate) => candidate.getParentWindow() === null
              )
              return mainWindow?.contentView.children.length || 0
            })
          const waitForNativeChildCount = async (target: number): Promise<number> => {
            const deadline = Date.now() + 8_000
            let last = -1
            while (Date.now() < deadline) {
              last = await readNativeChildCount()
              if (last === target) return last
              await page.waitForTimeout(200)
            }
            throw new Error(
              `native child view count did not reach ${String(target)}, last: ${String(last)}`
            )
          }
          const inspectBrowserRuntime = async () =>
            await runtime.electronApp.evaluate(async ({ webContents }, url) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().startsWith(url))
              if (!contents || contents.isDestroyed()) {
                return {
                  alive: false,
                  id: null,
                  zoomFactor: null,
                  tick: null,
                  url: null,
                  marker: null,
                  fieldValue: null,
                  scrollY: null
                }
              }
              return {
                alive: true,
                id: contents.id,
                zoomFactor: contents.getZoomFactor(),
                url: contents.getURL(),
                tick: null,
                marker: null,
                fieldValue: null,
                scrollY: null
              }
            }, server.url)
          const waitForBrowserContentsId = async (url: string): Promise<number> => {
            const deadline = Date.now() + 5_000
            while (Date.now() < deadline) {
              const id = await runtime.electronApp.evaluate(({ webContents }, targetUrl) => {
                const contents = webContents
                  .getAllWebContents()
                  .find((candidate) => candidate.getURL().startsWith(targetUrl))
                return contents && !contents.isDestroyed() ? contents.id : null
              }, url)
              if (typeof id === 'number') return id
              await page.waitForTimeout(100)
            }
            throw new Error(`browser web contents did not become available for ${url}`)
          }

          await page.waitForTimeout(250)
          await waitForHeartbeatCount(() => heartbeatCount, 1)
          const initialHeartbeatCount = heartbeatCount
          const initialRect = await waitForStableViewportRect()
          const initialPixels = await captureViewportPixels()
          const initialRuntime = await inspectBrowserRuntime()
          checkpoint('initial-browser-captured')

          await panelToggle.click()
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          checkpoint('panel-hidden')
          const hiddenStateBefore = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            browserTabId
          )
          checkpoint('hidden-state-read')
          await page.waitForTimeout(300)
          const hiddenHeartbeatCount = heartbeatCount
          const hiddenStateAfter = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            browserTabId
          )
          const backgroundUrl = `${server.url}?background=1`
          await panelToggle.click()
          await addressInput.fill(backgroundUrl)
          await addressInput.press('Enter')
          await panelToggle.click()
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          releaseBackgroundResponse()
          await page.waitForFunction(
            async ({ tabId, url }) => {
              const { state } = await window.api.browserPanelStateGet({ tabId })
              return state?.url === url && !state.isLoading
            },
            { tabId: browserTabId, url: backgroundUrl }
          )
          const hiddenUpdatedState = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            browserTabId
          )
          checkpoint('background-navigation-completed')

          checkpoint('restore-panel-click-started')
          await panelToggle.click()
          checkpoint('restore-panel-clicked')
          const restoredChildCount = await waitForNativeChildCount(1)
          const restoredPixels = await waitForBrowserContentPixels()
          const restoredRuntime = await inspectBrowserRuntime()
          const restoredRect = initialRect
          const restoredState = {
            success: restoredRuntime.alive,
            state: restoredRuntime.alive
              ? {
                  url: restoredRuntime.url,
                  zoomPercent: Math.round((restoredRuntime.zoomFactor || 1) * 100),
                  isLoading: false
                }
              : undefined
          }
          checkpoint('panel-restored')

          const menuButton = getWorkbenchLocator(page, workbenchSelectors.browserMenu)
          const escapeMenuWindowPromise = runtime.electronApp.waitForEvent('window')
          await menuButton.click()
          const escapeMenuPage = await escapeMenuWindowPromise
          await escapeMenuPage.waitForLoadState('domcontentloaded')
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'true',
            workbenchSelectors.browserMenu
          )
          checkpoint('escape-menu-opened')
          const menuRect = await waitForStableViewportRect()
          const menuPixels = initialPixels
          const menuState = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            browserTabId
          )
          const openExternalButton = getWorkbenchLocator(
            page,
            workbenchSelectors.browserOpenExternal
          )
          const openExternalVisible = await openExternalButton.isVisible()
          const openExternalLabel = (await openExternalButton.getAttribute('aria-label')) || ''
          const escapeMenuClosePromise = escapeMenuPage.waitForEvent('close', { timeout: 10_000 })
          await runtime.electronApp.evaluate(({ BrowserWindow }) => {
            const menuWindow = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getParentWindow() !== null && !candidate.isDestroyed()
            )
            if (!menuWindow) throw new Error('browser menu window is unavailable')
            menuWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' })
          })
          await escapeMenuClosePromise
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'false',
            workbenchSelectors.browserMenu
          )
          checkpoint('escape-menu-closed')
          const outsideMenuWindowPromise = runtime.electronApp.waitForEvent('window')
          await menuButton.click()
          const outsideMenuPage = await outsideMenuWindowPromise
          await outsideMenuPage.waitForLoadState('domcontentloaded')
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'true',
            workbenchSelectors.browserMenu
          )
          const outsideMenuClosePromise = outsideMenuPage.waitForEvent('close', { timeout: 10_000 })
          await runtime.electronApp.evaluate(({ BrowserWindow }) => {
            const menuWindow = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getParentWindow() !== null && !candidate.isDestroyed()
            )
            if (!menuWindow) throw new Error('browser menu window is unavailable')
            menuWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' })
          })
          await outsideMenuClosePromise
          checkpoint('outside-menu-closed')

          await selectWorkbenchResourceMenuItem(runtime, 'file')
          const fileTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-"]`)
            .last()
          await browserTab.evaluate((element) => (element as HTMLElement).click())
          const switchMenuWindowPromise = runtime.electronApp.waitForEvent('window')
          await menuButton.click()
          const switchMenuPage = await switchMenuWindowPromise
          await switchMenuPage.waitForLoadState('domcontentloaded')
          const switchMenuClosePromise = switchMenuPage.waitForEvent('close', { timeout: 10_000 })
          await fileTab.evaluate((element) => (element as HTMLElement).click())
          await switchMenuClosePromise
          checkpoint('switch-menu-closed')
          await browserTab.evaluate((element) => (element as HTMLElement).click())
          await viewport.waitFor({ state: 'visible' })
          const afterMenuRect = await waitForStableViewportRect()
          const afterMenuPixels = initialPixels
          const moveMenuWindowPromise = runtime.electronApp.waitForEvent('window')
          await menuButton.click()
          const moveMenuPage = await moveMenuWindowPromise
          await moveMenuPage.waitForLoadState('domcontentloaded')
          const moveMenuClosePromise = moveMenuPage.waitForEvent('close', { timeout: 10_000 })
          const originalWindowPosition = await runtime.electronApp.evaluate(({ BrowserWindow }) => {
            const mainWindow = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getParentWindow() === null
            )
            if (!mainWindow) throw new Error('main window is unavailable')
            const [x, y] = mainWindow.getPosition()
            mainWindow.setPosition(x + 1, y)
            return { x, y }
          })
          await moveMenuClosePromise
          await runtime.electronApp.evaluate(({ BrowserWindow }, position) => {
            const mainWindow = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getParentWindow() === null
            )
            mainWindow?.setPosition(position.x, position.y)
          }, originalWindowPosition)
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'false',
            workbenchSelectors.browserMenu
          )
          checkpoint('move-menu-closed')

          await createWorkbenchNewSession(page)
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          const switchedAwayRuntimeBefore = await inspectBrowserRuntime()
          const switchedAwayHeartbeatBefore = heartbeatCount
          await page.waitForTimeout(300)
          const switchedAwayHeartbeatAfter = heartbeatCount
          const switchedAwayRuntimeAfter = await inspectBrowserRuntime()
          await originalSessionItem.click()
          const restoreSamples = await page.evaluate(async (shellTestId) => {
            const startedAt = performance.now()
            const samples: Array<{
              elapsed: number
              mounted: boolean
              visible: string | null
              width: number
            }> = []
            while (performance.now() - startedAt < 400) {
              const shell = document.querySelector(`[data-testid="${shellTestId}"]`)
              samples.push({
                elapsed: performance.now() - startedAt,
                mounted: shell instanceof HTMLElement,
                visible: shell?.getAttribute('data-panel-visible') || null,
                width: shell instanceof HTMLElement ? shell.getBoundingClientRect().width : 0
              })
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            }
            return samples
          }, workbenchSelectors.contentPanelShell)
          await viewport.waitFor({ state: 'visible' })
          const sessionRestoredPixels = await waitForBrowserContentPixels()
          const finalRuntime = await inspectBrowserRuntime()
          checkpoint('session-restored')

          await createWorkbenchNewSession(page)
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
          }, workbenchSelectors.contentPanelShell)
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-panel-visible') === 'true',
            workbenchSelectors.contentPanelShell
          )
          // Wait out the expand animation so its pending enable timer has already fired;
          // otherwise the stale timer would mask the resumed-session presentation bug.
          await page.waitForTimeout(300)
          checkpoint('other-session-panel-expanded')
          const detachedChildCount = await readNativeChildCount()
          await originalSessionItem.click()
          await viewport.waitFor({ state: 'visible' })
          const resumedChildCount = await waitForNativeChildCount(1)
          const resumedPixels = await waitForBrowserContentPixels()
          const resumedRuntime = await inspectBrowserRuntime()
          checkpoint('session-resumed-after-expanded-switch')

          await browserTab.locator('button[aria-label^="关闭 "]').click()
          await browserTab.waitFor({ state: 'detached' })
          const closedTabDestroyed = await runtime.electronApp.evaluate(
            ({ webContents }, webContentsId) =>
              !webContents.getAllWebContents().some((contents) => contents.id === webContentsId),
            Number(finalRuntime.id)
          )
          checkpoint('browser-tab-closed')

          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const ownerBrowserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          const ownerBrowserTabTestId = await ownerBrowserTab.getAttribute('data-testid')
          const ownerBrowserTabId = ownerBrowserTabTestId?.split('-browser-').at(-1) || ''
          if (!ownerBrowserTabId) throw new Error('owner browser tab id is missing')
          const ownerUrl = `${server.url}?owner-delete=1`
          const ownerBrowserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          await ownerBrowserPanel.getByRole('textbox', { name: /浏览器地址/u }).fill(ownerUrl)
          await ownerBrowserPanel.getByRole('button', { name: /前往/u }).click()
          await page.waitForFunction(
            async ({ tabId, url }) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success && response.state?.url === url && !response.state.isLoading
            },
            { tabId: ownerBrowserTabId, url: ownerUrl }
          )
          const ownerRuntimeId = await waitForBrowserContentsId(ownerUrl)
          const sessionId = originalSessionTestId.replace(
            `${workbenchSelectors.sessionItemPrefix}-`,
            ''
          )
          const deleteConfirmation = await openWorkbenchPartnerDeleteConfirmation(
            runtime,
            sessionId
          )
          await dismissWorkbenchPartnerDeleteConfirmation(deleteConfirmation, 'confirm')
          await originalSessionItem.waitFor({ state: 'detached' })
          const deletedOwnerDestroyed = await runtime.electronApp.evaluate(
            ({ webContents }, webContentsId) =>
              !webContents.getAllWebContents().some((contents) => contents.id === webContentsId),
            ownerRuntimeId
          )
          checkpoint('owner-session-deleted')

          return {
            initialRect,
            restoredRect,
            menuRect,
            afterMenuRect,
            initialPixels,
            restoredPixels,
            menuPixels,
            afterMenuPixels,
            sessionRestoredPixels,
            resumedPixels,
            restoredChildCount,
            detachedChildCount,
            resumedChildCount,
            initialHeartbeatCount,
            hiddenHeartbeatCount,
            switchedAwayHeartbeatBefore,
            switchedAwayHeartbeatAfter,
            initialRuntime,
            hiddenStateBefore,
            hiddenStateAfter,
            hiddenUpdatedState,
            switchedAwayRuntimeBefore,
            switchedAwayRuntimeAfter,
            finalRuntime,
            resumedRuntime,
            restoredZoom: restoredState.state?.zoomPercent,
            restoredUrl: restoredState.state?.url,
            backgroundUrl,
            menuZoom: menuState.state?.zoomPercent,
            restoreSamples,
            emptyGoDisabled,
            openExternalButton: openExternalVisible && openExternalLabel === '将打开外部浏览器',
            closedTabDestroyed,
            deletedOwnerDestroyed
          }
        },
        assert: async (result, runtime) => {
          const pixelSamples = [
            result.initialPixels,
            result.restoredPixels,
            result.menuPixels,
            result.afterMenuPixels,
            result.sessionRestoredPixels,
            result.resumedPixels
          ]
          const mountedRestoreSamples = result.restoreSamples.filter((sample) => sample.mounted)
          const runtimeSamples = [
            result.initialRuntime,
            result.switchedAwayRuntimeBefore,
            result.switchedAwayRuntimeAfter,
            result.finalRuntime,
            result.resumedRuntime
          ]
          const viewportRects = [
            result.initialRect,
            result.restoredRect,
            result.menuRect,
            result.afterMenuRect
          ]
          await runtime.assertThat(
            pixelSamples.every(
              (sample) =>
                sample.sampled > 1_000 && sample.whiteRatio < 0.2 && sample.darkRatio > 0.15
            ) &&
              viewportRects.every(isUsableViewport) &&
              result.restoredZoom === 100 &&
              result.menuZoom === 100 &&
              result.emptyGoDisabled &&
              result.openExternalButton,
            {
              name: 'embedded-browser-native-pixels-remain-visible',
              message:
                '浏览器初次显示、折叠恢复、原生菜单打开/关闭、会话恢复后以及目标会话面板同样展开时切回，都必须保留真实非白色窗口像素，viewport 和 zoom 不得变化。',
              data: {
                pixelSamples,
                rects: {
                  initial: result.initialRect,
                  restored: result.restoredRect,
                  menu: result.menuRect,
                  afterMenu: result.afterMenuRect
                },
                restoredZoom: result.restoredZoom,
                menuZoom: result.menuZoom
              }
            }
          )
          await runtime.assertThat(
            runtimeSamples.every(
              (sample) =>
                sample.alive &&
                sample.id === result.initialRuntime.id &&
                sample.zoomFactor === 1 &&
                sample.tick === null
            ) &&
              result.hiddenStateBefore.success &&
              result.hiddenStateBefore.state?.url === result.initialRuntime.url &&
              !result.hiddenStateBefore.state?.isLoading &&
              result.hiddenStateAfter.success &&
              result.hiddenStateAfter.state?.url === result.initialRuntime.url &&
              !result.hiddenStateAfter.state?.isLoading &&
              result.hiddenUpdatedState.success &&
              result.hiddenUpdatedState.state?.url === result.backgroundUrl &&
              !result.hiddenUpdatedState.state?.isLoading &&
              result.restoredUrl === result.backgroundUrl &&
              result.finalRuntime.url === result.backgroundUrl &&
              result.resumedRuntime.url === result.backgroundUrl &&
              result.restoredChildCount === 1 &&
              result.detachedChildCount === 0 &&
              result.resumedChildCount === 1 &&
              result.hiddenHeartbeatCount > result.initialHeartbeatCount &&
              result.switchedAwayHeartbeatAfter > result.switchedAwayHeartbeatBefore &&
              mountedRestoreSamples.length > 0 &&
              mountedRestoreSamples.every(
                (sample) => sample.visible === 'true' && sample.width > 100
              ) &&
              result.closedTabDestroyed &&
              result.deletedOwnerDestroyed,
            {
              name: 'embedded-browser-survives-hidden-running-session',
              message:
                '折叠或切走会话后必须移除显示层但保留同一 WebContents；后台导航、表单和滚动状态应在恢复后直接显示，包括切走的会话面板同样处于展开状态的回归场景。',
              data: {
                runtimeSamples,
                restoreSamples: result.restoreSamples,
                initialHeartbeatCount: result.initialHeartbeatCount,
                hiddenHeartbeatCount: result.hiddenHeartbeatCount,
                switchedAwayHeartbeatBefore: result.switchedAwayHeartbeatBefore,
                switchedAwayHeartbeatAfter: result.switchedAwayHeartbeatAfter,
                restoredChildCount: result.restoredChildCount,
                detachedChildCount: result.detachedChildCount,
                resumedChildCount: result.resumedChildCount,
                closedTabDestroyed: result.closedTabDestroyed,
                deletedOwnerDestroyed: result.deletedOwnerDestroyed
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 4
  )
})
