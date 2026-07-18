import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-view-lifecycle'

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
        fixtures: [],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(`<!doctype html>
            <html>
              <head>
                <title>Browser lifecycle fixture</title>
                <style>
                  html, body { width: 100%; height: 100%; margin: 0; background: #101820; color: #ffffff; }
                  body { display: grid; place-items: center; font: 700 36px system-ui; }
                  main { width: 72%; padding: 48px; background: #d7263d; border: 20px solid #20bf55; }
                </style>
              </head>
              <body>
                <main>BROWSER VIEW IS LIVE</main>
                <script>
                  window.lifecycleTick = 0
                  setInterval(() => { window.lifecycleTick += 1 }, 50)
                </script>
              </body>
            </html>`)

          try {
            await navigateToWorkbench(page, { waitForSessionListText: false })
            const sessionIds = await page.evaluate(async () => {
              const original = crypto.randomUUID()
              const secondary = crypto.randomUUID()
              const workspaceResponse = await window.api.workspaceCreate({
                name: `Browser lifecycle ${crypto.randomUUID().slice(0, 8)}`
              })
              const workspaceId = workspaceResponse.workspace?.id
              if (!workspaceResponse.success || !workspaceId) {
                throw new Error(workspaceResponse.error || 'failed to seed workspace')
              }
              const originalResponse = await window.api.chatSessionSave({
                id: original,
                title: 'Browser lifecycle A',
                created_at: Date.now() - 1_000,
                workspace_id: workspaceId
              })
              const secondaryResponse = await window.api.chatSessionSave({
                id: secondary,
                title: 'Browser lifecycle B',
                created_at: Date.now(),
                workspace_id: workspaceId
              })
              if (!originalResponse.success || !secondaryResponse.success) {
                throw new Error(
                  originalResponse.error || secondaryResponse.error || 'failed to seed sessions'
                )
              }
              return { original, secondary }
            })
            await page.reload()
            await navigateToWorkbench(page, { waitForSessionListText: false })
            const originalSessionTestId = `${workbenchSelectors.sessionItemPrefix}-${sessionIds.original}`
            const secondarySessionTestId = `${workbenchSelectors.sessionItemPrefix}-${sessionIds.secondary}`
            const originalSessionItem = page.locator(`[data-testid="${originalSessionTestId}"]`)
            await originalSessionItem.waitFor({ state: 'visible' })
            await originalSessionItem.click()

            const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
            if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
              await panelToggle.click()
            }
            await page.waitForFunction((testId) => {
              const shell = document.querySelector(`[data-testid="${testId}"]`)
              return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
            }, workbenchSelectors.contentPanelShell)

            await getWorkbenchLocator(page, workbenchSelectors.resourceTabAddButton).click()
            await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()
            const browserTab = page
              .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
              .last()
            await browserTab.waitFor({ state: 'visible' })
            const browserTabTestId = await browserTab.getAttribute('data-testid')
            const browserTabId = browserTabTestId?.split('-browser-').at(-1) || ''
            if (!browserTabId) throw new Error('browser tab id is missing')

            const navigateResponse = await page.evaluate(
              async ({ tabId, url }) => window.api.browserTabNavigate({ tabId, url }),
              { tabId: browserTabId, url: server.url }
            )
            if (!navigateResponse.success) {
              throw new Error(navigateResponse.error || 'browser fixture navigation failed')
            }
            await page.waitForFunction(
              async ({ tabId, url }) => {
                const response = await window.api.browserPanelStateGet({ tabId })
                return response.success && response.state?.url === url && !response.state.isLoading
              },
              { tabId: browserTabId, url: server.url }
            )

            const viewport = getWorkbenchLocator(page, workbenchSelectors.browserViewport)
            const readViewportRect = async (): Promise<ViewportRect | null> => {
              const box = await viewport.boundingBox()
              return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
            }
            const captureViewportPixels = async () => {
              const rect = await readViewportRect()
              if (!rect) throw new Error('browser viewport bounds are missing')
              return await runtime.electronApp.evaluate(
                async ({ BrowserWindow, desktopCapturer }, input) => {
                  const window = BrowserWindow.getAllWindows()[0]
                  if (!window || window.isDestroyed()) throw new Error('main window is unavailable')
                  const windowBounds = window.getBounds()
                  const contentBounds = window.getContentBounds()
                  const mediaSourceId = window.getMediaSourceId()
                  const sources = await desktopCapturer.getSources({
                    types: ['window'],
                    thumbnailSize: {
                      width: Math.max(1, windowBounds.width),
                      height: Math.max(1, windowBounds.height)
                    }
                  })
                  const source =
                    sources.find((candidate) => candidate.id === mediaSourceId) ||
                    sources.find((candidate) => candidate.name === window.getTitle())
                  if (!source) throw new Error('desktop capture source is unavailable')

                  const image = source.thumbnail
                  const size = image.getSize()
                  const bitmap = image.toBitmap()
                  const scaleX = size.width / windowBounds.width
                  const scaleY = size.height / windowBounds.height
                  const contentOffsetX = contentBounds.x - windowBounds.x
                  const contentOffsetY = contentBounds.y - windowBounds.y
                  const left = Math.max(0, Math.floor((contentOffsetX + input.rect.x) * scaleX))
                  const top = Math.max(0, Math.floor((contentOffsetY + input.rect.y) * scaleY))
                  const right = Math.min(
                    size.width,
                    Math.ceil((contentOffsetX + input.rect.x + input.rect.width) * scaleX)
                  )
                  const bottom = Math.min(
                    size.height,
                    Math.ceil((contentOffsetY + input.rect.y + input.rect.height) * scaleY)
                  )
                  let sampled = 0
                  let white = 0
                  let dark = 0
                  for (let y = top; y < bottom; y += 3) {
                    for (let x = left; x < right; x += 3) {
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
                },
                { rect }
              )
            }
            const inspectBrowserRuntime = async () =>
              await runtime.electronApp.evaluate(async ({ webContents }, url) => {
                const contents = webContents
                  .getAllWebContents()
                  .find((candidate) => candidate.getURL() === url)
                if (!contents || contents.isDestroyed()) {
                  return { alive: false, id: null, zoomFactor: null, tick: null }
                }
                return {
                  alive: true,
                  id: contents.id,
                  zoomFactor: contents.getZoomFactor(),
                  tick: await contents.executeJavaScript('window.lifecycleTick')
                }
              }, server.url)

            await page.waitForTimeout(250)
            const initialRect = await readViewportRect()
            const initialPixels = await captureViewportPixels()
            const initialRuntime = await inspectBrowserRuntime()

            await panelToggle.click()
            await page.waitForFunction(
              (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
              workbenchSelectors.contentPanelShell
            )
            const hiddenRuntimeBefore = await inspectBrowserRuntime()
            await page.waitForTimeout(300)
            const hiddenRuntimeAfter = await inspectBrowserRuntime()

            await panelToggle.click()
            await page.waitForFunction((testId) => {
              const shell = document.querySelector(`[data-testid="${testId}"]`)
              return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
            }, workbenchSelectors.contentPanelShell)
            await viewport.waitFor({ state: 'visible' })
            await page.waitForTimeout(300)
            const restoredRect = await readViewportRect()
            const restoredPixels = await captureViewportPixels()
            const restoredState = await page.evaluate(
              async (tabId) => window.api.browserPanelStateGet({ tabId }),
              browserTabId
            )

            const menuButton = getWorkbenchLocator(page, workbenchSelectors.browserMenu)
            await menuButton.click()
            await page.waitForFunction(
              (testId) =>
                document
                  .querySelector(`[data-testid="${testId}"]`)
                  ?.getAttribute('aria-expanded') === 'true',
              workbenchSelectors.browserMenu
            )
            const menuRect = await readViewportRect()
            const menuPixels = await captureViewportPixels()
            const menuState = await page.evaluate(
              async (tabId) => window.api.browserPanelStateGet({ tabId }),
              browserTabId
            )
            await page.evaluate(async () => await window.api.browserPanelCloseMenu())
            await page.waitForFunction(
              (testId) =>
                document
                  .querySelector(`[data-testid="${testId}"]`)
                  ?.getAttribute('aria-expanded') === 'false',
              workbenchSelectors.browserMenu
            )
            const afterMenuRect = await readViewportRect()
            const afterMenuPixels = await captureViewportPixels()

            await page.locator(`[data-testid="${secondarySessionTestId}"]`).click()
            await page.waitForFunction(
              (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
              workbenchSelectors.contentPanelShell
            )
            const switchedAwayRuntimeBefore = await inspectBrowserRuntime()
            await page.waitForTimeout(300)
            const switchedAwayRuntimeAfter = await inspectBrowserRuntime()
            const restoreSamples = await page.evaluate(
              async ({ sessionTestId, shellTestId }) => {
                const session = document.querySelector(`[data-testid="${sessionTestId}"]`)
                if (!(session instanceof HTMLElement)) return []
                session.click()
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
              },
              {
                sessionTestId: originalSessionTestId,
                shellTestId: workbenchSelectors.contentPanelShell
              }
            )
            await viewport.waitFor({ state: 'visible' })
            const sessionRestoredPixels = await captureViewportPixels()
            const finalRuntime = await inspectBrowserRuntime()

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
              initialRuntime,
              hiddenRuntimeBefore,
              hiddenRuntimeAfter,
              switchedAwayRuntimeBefore,
              switchedAwayRuntimeAfter,
              finalRuntime,
              restoredZoom: restoredState.state?.zoomPercent,
              menuZoom: menuState.state?.zoomPercent,
              restoreSamples
            }
          } finally {
            await server.close()
          }
        },
        assert: async (result, runtime) => {
          const pixelSamples = [
            result.initialPixels,
            result.restoredPixels,
            result.menuPixels,
            result.afterMenuPixels,
            result.sessionRestoredPixels
          ]
          const mountedRestoreSamples = result.restoreSamples.filter((sample) => sample.mounted)
          const runtimeSamples = [
            result.initialRuntime,
            result.hiddenRuntimeBefore,
            result.hiddenRuntimeAfter,
            result.switchedAwayRuntimeBefore,
            result.switchedAwayRuntimeAfter,
            result.finalRuntime
          ]
          await runtime.assertThat(
            pixelSamples.every(
              (sample) =>
                sample.sampled > 1_000 && sample.whiteRatio < 0.2 && sample.darkRatio > 0.15
            ) &&
              sameSize(result.initialRect, result.restoredRect) &&
              sameSize(result.restoredRect, result.menuRect) &&
              sameSize(result.menuRect, result.afterMenuRect) &&
              result.restoredZoom === 100 &&
              result.menuZoom === 100,
            {
              name: 'embedded-browser-native-pixels-remain-visible',
              message:
                '浏览器初次显示、折叠恢复、原生菜单打开/关闭和会话恢复后都必须保留真实非白色窗口像素，viewport 和 zoom 不得变化。',
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
                typeof sample.tick === 'number'
            ) &&
              Number(result.hiddenRuntimeAfter.tick) > Number(result.hiddenRuntimeBefore.tick) &&
              Number(result.switchedAwayRuntimeAfter.tick) >
                Number(result.switchedAwayRuntimeBefore.tick) &&
              mountedRestoreSamples.length > 0 &&
              mountedRestoreSamples.every(
                (sample) => sample.visible === 'true' && sample.width > 100
              ),
            {
              name: 'embedded-browser-survives-hidden-running-session',
              message:
                '折叠侧栏或切走会话只能停放浏览器视图；同一 WebContents 必须继续运行，回到原会话时侧栏直接以最终宽度恢复且不重播动画。',
              data: {
                runtimeSamples,
                restoreSamples: result.restoreSamples
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 4
  )
})
