import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  sendWorkbenchMessage,
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
        serviceMode: 'real',
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
          runtime.registerResource({
            name: 'browser-lifecycle-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })

          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: WORKSPACE_NAME,
            createSession: false
          })
          const liveEnv = setup.env
          await page.getByRole('button', { name: `在 ${WORKSPACE_NAME} 中新建对话` }).click()
          const originalSessionTestId = await page
            .locator(
              `[data-testid^="${workbenchSelectors.sessionItemPrefix}-"].nc-sidebar-item-active`
            )
            .getAttribute('data-testid')
          if (!originalSessionTestId) throw new Error('active session id is missing')
          const sessionStartedAt = Date.now()
          await sendWorkbenchMessage(page, SESSION_PROMPT)
          await waitForWorkbenchAiRunCompletion(
            runtime,
            sessionStartedAt,
            liveEnv.modelName,
            240_000,
            { page }
          )
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

          await getWorkbenchLocator(page, workbenchSelectors.resourceTabAddButton).click()
          await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()
          const browserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          await browserTab.waitFor({ state: 'visible' })
          const browserTabTestId = await browserTab.getAttribute('data-testid')
          const browserTabId = browserTabTestId?.split('-browser-').at(-1) || ''
          if (!browserTabId) throw new Error('browser tab id is missing')

          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          await browserPanel.getByRole('textbox', { name: /浏览器地址/u }).fill(server.url)
          await browserPanel.getByRole('button', { name: /前往/u }).click()
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
            return await runtime.electronApp.evaluate(async ({ webContents }, url) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL() === url)
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
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'true',
            workbenchSelectors.browserMenu
          )
          const menuRect = await readViewportRect()
          const menuPixels = await captureViewportPixels()
          const menuState = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            browserTabId
          )
          await page.keyboard.press('Escape')
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'false',
            workbenchSelectors.browserMenu
          )
          const afterMenuRect = await readViewportRect()
          const afterMenuPixels = await captureViewportPixels()

          await createWorkbenchNewSession(page)
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          const switchedAwayRuntimeBefore = await inspectBrowserRuntime()
          await page.waitForTimeout(300)
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
