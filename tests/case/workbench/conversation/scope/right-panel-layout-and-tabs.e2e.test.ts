import { describe, it } from 'vitest'
import type { Event } from 'electron'
import { windowSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  ensureWorkbenchContentPanelExpanded,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  selectWorkbenchResourceMenuItem,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'right-panel-layout-and-tabs'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['scope'],
        description:
          '验证空会话输入区、右侧动态 Tab 拖拽区、横向滚动、原生窗口层分离和浏览器缩放菜单。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, '右侧栏布局伙伴')

          // Empty-composer geometry must be measured with a partner selected and the
          // right panel collapsed (full main-pane height). Partner create collapses it.
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell === null
          }, workbenchSelectors.contentPanelShell)
          await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })

          const emptyLayout = await page.evaluate((selectors) => {
            const shell = document.querySelector(`[data-testid="${selectors.composerShell}"]`)
            const input = document.querySelector(`[data-testid="${selectors.input}"]`)
            const main = document.querySelector('.nc-main-pane')
            if (!(shell instanceof HTMLElement) || !(input instanceof HTMLElement) || !main) {
              return null
            }
            const shellRect = shell.getBoundingClientRect()
            const inputRect = input.getBoundingClientRect()
            const mainRect = main.getBoundingClientRect()
            return {
              shellDisplay: getComputedStyle(shell).display,
              inputCenterY: inputRect.top + inputRect.height / 2,
              mainCenterY: mainRect.top + mainRect.height / 2,
              shellHeight: shellRect.height,
              mainHeight: mainRect.height
            }
          }, workbenchSelectors)

          const initialShellCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()

          await ensureWorkbenchContentPanelExpanded(page)
          await page.waitForTimeout(300)
          const windowHandle = await runtime.electronApp.browserWindow(page)
          const cursorObserver = await windowHandle.evaluateHandle((window) => {
            const events: string[] = []
            const listener = (_event: Event, type: string) => events.push(type)
            window.webContents.on('cursor-changed', listener)
            return {
              events,
              dispose: () => {
                window.webContents.off('cursor-changed', listener)
              }
            }
          })
          const inspectResizeHandles = async () => {
            const result: { testId: string; cursor: string; hitTestId: string | null }[] = []
            for (const testId of [
              workbenchSelectors.sidebarResizer,
              workbenchSelectors.contentPanelResizer
            ]) {
              const point = await getWorkbenchLocator(page, testId).evaluate((element) => {
                const rect = element.getBoundingClientRect()
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
              })
              await page.mouse.move(point.x - 15, point.y)
              await page.mouse.move(point.x, point.y, { steps: 2 })
              const hit = await page.evaluate((point) => {
                const element = document.elementFromPoint(point.x, point.y)
                return {
                  cursor: element ? getComputedStyle(element).cursor : '',
                  hitTestId: element?.getAttribute('data-testid') || null
                }
              }, point)
              result.push({ testId, ...hit })
            }
            return result
          }
          const fileResizeHandles = await inspectResizeHandles()
          const resourceMenu = await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const fileMenuLabelVisible = resourceMenu.fileVisible
          const legacyFileMenuLabelCount = await page
            .getByRole('menuitem', { name: '打开文件', exact: true })
            .count()

          const tabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          await tabs.first().waitFor({ state: 'visible' })
          const browserResizeHandles = await inspectResizeHandles()
          const nativeResizeCursors = await cursorObserver.evaluate((observer) => observer.events)
          await cursorObserver.evaluate((observer) => observer.dispose())
          await cursorObserver.dispose()
          await runtime.assertThat(
            [...fileResizeHandles, ...browserResizeHandles].every(
              (handle) => handle.hitTestId === handle.testId && handle.cursor === 'ew-resize'
            ) && nativeResizeCursors.includes('ew-resize'),
            {
              name: 'resize-handles-hit-test-and-cursor',
              message: '两条分隔线的透明热区应命中拖动控件并显示水平调整光标。',
              data: { fileResizeHandles, browserResizeHandles, nativeResizeCursors }
            }
          )
          const panelWidth = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).evaluate((element) => element.getBoundingClientRect().width)
          const resizePoint = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelResizer
          ).evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          })
          await page.mouse.move(resizePoint.x, resizePoint.y)
          await page.mouse.down()
          await page.mouse.move(resizePoint.x + panelWidth - 440, resizePoint.y, { steps: 10 })
          await page.mouse.up()
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return (
              element instanceof HTMLElement &&
              Math.abs(element.getBoundingClientRect().width - 440) < 2
            )
          }, workbenchSelectors.contentPanelShell)
          const readTabDragLayout = async () =>
            await page.evaluate(
              (selectors) => {
                const tabbar = document.querySelector(
                  `[data-testid="${selectors.workbench.resourceTabBar}"]`
                )
                const scroller = document.querySelector(
                  `[data-testid="${selectors.workbench.resourceTabScroller}"]`
                )
                const dragRegion = document.querySelector(
                  `[data-testid="${selectors.workbench.resourceTabDragRegion}"]`
                )
                const addButton = document.querySelector(
                  `[data-testid="${selectors.workbench.resourceTabAddButton}"]`
                )
                const toggle = document.querySelector(
                  `[data-testid="${selectors.workbench.contentPanelToggle}"]`
                )
                if (
                  !(tabbar instanceof HTMLElement) ||
                  !(scroller instanceof HTMLElement) ||
                  !(dragRegion instanceof HTMLElement) ||
                  !(addButton instanceof HTMLElement) ||
                  !(toggle instanceof HTMLElement)
                ) {
                  return null
                }

                const dragRect = dragRegion.getBoundingClientRect()
                const addRect = addButton.getBoundingClientRect()
                const toggleRect = toggle.getBoundingClientRect()
                const hit =
                  dragRect.width > 2
                    ? document.elementFromPoint(
                        dragRect.left + dragRect.width / 2,
                        dragRect.top + dragRect.height / 2
                      )
                    : null
                const nativeChrome = document.querySelector(
                  `[data-testid="${selectors.window.nativeChrome}"]`
                )
                const nativeChromeRect =
                  nativeChrome instanceof HTMLElement ? nativeChrome.getBoundingClientRect() : null

                return {
                  platform: navigator.userAgent.toLowerCase().includes('windows')
                    ? 'win32'
                    : 'other',
                  tabbarTop: tabbar.getBoundingClientRect().top,
                  tabbarHeight: tabbar.getBoundingClientRect().height,
                  appRegion: getComputedStyle(dragRegion).getPropertyValue('-webkit-app-region'),
                  pointerEvents: getComputedStyle(dragRegion).pointerEvents,
                  dragWidth: dragRect.width,
                  dragHeight: dragRect.height,
                  dragRight: dragRect.right,
                  hitTestId: hit?.closest<HTMLElement>('[data-testid]')?.dataset.testid || null,
                  addLeft: addRect.left,
                  addRight: addRect.right,
                  toggleLeft: toggleRect.left,
                  toggleRight: toggleRect.right,
                  scrollWidth: scroller.scrollWidth,
                  clientWidth: scroller.clientWidth,
                  nativeChrome:
                    nativeChromeRect === null
                      ? null
                      : {
                          height: nativeChromeRect.height,
                          bottom: nativeChromeRect.bottom
                        }
                }
              },
              { workbench: workbenchSelectors, window: windowSelectors }
            )

          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLElement && element.getBoundingClientRect().width > 40
          }, workbenchSelectors.resourceTabDragRegion)
          const sparseDragLayout = await readTabDragLayout()

          for (let index = 0; index < 7; index += 1) {
            await selectWorkbenchResourceMenuItem(runtime, 'browser')
          }

          await tabs.nth(7).waitFor({ state: 'visible' })
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLElement && element.getBoundingClientRect().width <= 1
          }, workbenchSelectors.resourceTabDragRegion)
          const denseDragLayout = await readTabDragLayout()

          for (let index = 7; index >= 1; index -= 1) {
            await tabs.nth(index).locator('button[aria-label^="关闭 "]').click()
            await page.waitForFunction(
              (input) =>
                document.querySelectorAll(`[data-testid^="${input.prefix}-"]`).length ===
                input.count,
              { prefix: workbenchSelectors.resourceTabPrefix, count: index }
            )
          }
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLElement && element.getBoundingClientRect().width > 40
          }, workbenchSelectors.resourceTabDragRegion)
          const recoveredDragLayout = await readTabDragLayout()

          for (let index = 0; index < 7; index += 1) {
            await selectWorkbenchResourceMenuItem(runtime, 'browser')
          }
          await tabs.nth(7).waitFor({ state: 'visible' })
          await tabs.first().click()
          const scroller = getWorkbenchLocator(page, workbenchSelectors.resourceTabScroller)
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element instanceof HTMLElement && element.scrollLeft <= 1
          }, workbenchSelectors.resourceTabScroller)
          const scrollBefore = await scroller.evaluate((element) => element.scrollLeft)
          await scroller.dispatchEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true })
          await page.waitForFunction(
            (input) => {
              const element = document.querySelector(`[data-testid="${input.testId}"]`)
              return element instanceof HTMLElement && element.scrollLeft > input.before
            },
            { testId: workbenchSelectors.resourceTabScroller, before: scrollBefore }
          )

          const chromeLayout = await page.evaluate((selectors) => {
            const tabbar = document.querySelector(`[data-testid="${selectors.resourceTabBar}"]`)
            const scrollerElement = document.querySelector(
              `[data-testid="${selectors.resourceTabScroller}"]`
            )
            const toggle = document.querySelector(`[data-testid="${selectors.contentPanelToggle}"]`)
            if (
              !(tabbar instanceof HTMLElement) ||
              !(scrollerElement instanceof HTMLElement) ||
              !(toggle instanceof HTMLElement)
            ) {
              return null
            }
            const tabbarRect = tabbar.getBoundingClientRect()
            const toggleRect = toggle.getBoundingClientRect()
            return {
              tabbarHeight: tabbarRect.height,
              tabbarBorderBottom: getComputedStyle(tabbar).borderBottomWidth,
              toggleInsideTabbar:
                toggleRect.left >= tabbarRect.left && toggleRect.right <= tabbarRect.right,
              toggleAppRegion: getComputedStyle(toggle).getPropertyValue('-webkit-app-region'),
              scrollWidth: scrollerElement.scrollWidth,
              clientWidth: scrollerElement.clientWidth,
              scrollLeft: scrollerElement.scrollLeft
            }
          }, workbenchSelectors)

          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const browserGoButtonVisible = await browserPanel
            .getByRole('button', { name: '前往' })
            .isVisible()
          const activeBrowserTestId = await tabs.nth(7).getAttribute('data-testid')
          const activeBrowserTabId = activeBrowserTestId?.split('-browser-').at(-1) || ''
          const browserViewport = getWorkbenchLocator(page, workbenchSelectors.browserViewport)
          const viewportBeforeMenu = await browserViewport.boundingBox()
          const zoomBeforeMenu = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            activeBrowserTabId
          )
          const browserMenuButton = browserPanel.getByRole('button', {
            name: '更多浏览器操作'
          })
          const readNativeChildCount = async () =>
            await runtime.electronApp.evaluate(({ BrowserWindow }) => {
              const mainWindow = BrowserWindow.getAllWindows().find(
                (candidate) => candidate.getParentWindow() === null
              )
              return mainWindow?.contentView.children.length || 0
            })
          const nativeChildCountBeforeMenu = await readNativeChildCount()
          const browserMenuWindowPromise = runtime.electronApp.waitForEvent('window')
          await browserMenuButton.click()
          const browserMenuPage = await browserMenuWindowPromise
          await browserMenuPage.waitForLoadState('domcontentloaded')
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'true',
            workbenchSelectors.browserMenu
          )
          const viewportDuringMenu = await browserViewport.boundingBox()
          const nativeChildCountDuringMenu = await readNativeChildCount()
          const zoomOutControl = browserMenuPage.getByRole('link', { name: '缩小页面' })
          const zoomResetControl = browserMenuPage.getByRole('link', {
            name: '恢复页面缩放为 100%'
          })
          const zoomInControl = browserMenuPage.getByRole('link', { name: '放大页面' })
          const zoomControlBoxes = await Promise.all([
            zoomOutControl.boundingBox(),
            zoomResetControl.boundingBox(),
            zoomInControl.boundingBox()
          ])
          await zoomOutControl.click()
          await page.waitForFunction(
            async (tabId) =>
              (await window.api.browserPanelStateGet({ tabId })).state?.zoomPercent === 90,
            activeBrowserTabId
          )
          const menuStayedOpenAfterZoom = !browserMenuPage.isClosed()
          await zoomResetControl.click()
          await page.waitForFunction(
            async (tabId) =>
              (await window.api.browserPanelStateGet({ tabId })).state?.zoomPercent === 100,
            activeBrowserTabId
          )
          const zoomDuringMenu = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            activeBrowserTabId
          )
          const menuClosed = browserMenuPage.waitForEvent('close')
          await browserMenuPage.keyboard.press('Escape')
          await menuClosed
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-expanded') ===
              'false',
            workbenchSelectors.browserMenu
          )
          const viewportAfterMenu = await browserViewport.boundingBox()
          const zoomAfterMenu = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            activeBrowserTabId
          )

          const collapseToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          await collapseToggle.hover()
          const hoverOverflow = await page.evaluate(() => ({
            horizontal: document.documentElement.scrollWidth > window.innerWidth,
            vertical: document.documentElement.scrollHeight > window.innerHeight
          }))
          await collapseToggle.click()
          const shellPresentDuringExit =
            (await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).count()) === 1
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell === null
          }, workbenchSelectors.contentPanelShell)
          const restoreButtonRightOffset = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelToggle
          ).evaluate((element) => window.innerWidth - element.getBoundingClientRect().right)
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
          }, workbenchSelectors.contentPanelShell)

          return {
            emptyLayout,
            initialShellCount,
            fileMenuLabelVisible,
            legacyFileMenuLabelCount,
            tabCount: await tabs.count(),
            sparseDragLayout,
            denseDragLayout,
            recoveredDragLayout,
            chromeLayout,
            browserMenuLayout: {
              viewportBeforeMenu,
              viewportDuringMenu,
              viewportAfterMenu,
              nativeChildCountBeforeMenu,
              nativeChildCountDuringMenu,
              zoomControlBoxes,
              menuStayedOpenAfterZoom,
              zoomBeforeMenu: zoomBeforeMenu.state?.zoomPercent,
              zoomDuringMenu: zoomDuringMenu.state?.zoomPercent,
              zoomAfterMenu: zoomAfterMenu.state?.zoomPercent
            },
            browserGoButtonVisible,
            hoverOverflow,
            shellPresentDuringExit,
            restoreButtonRightOffset
          }
        },
        assert: async (result, runtime) => {
          const windowsChromeSeparated =
            result.sparseDragLayout?.platform !== 'win32' ||
            (result.sparseDragLayout.nativeChrome !== null &&
              Math.round(result.sparseDragLayout.nativeChrome.height) === 36 &&
              result.sparseDragLayout.tabbarTop >= result.sparseDragLayout.nativeChrome.bottom)

          await runtime.assertThat(
            result.emptyLayout !== null &&
              result.initialShellCount === 0 &&
              result.emptyLayout.shellDisplay === 'flex' &&
              Math.abs(result.emptyLayout.inputCenterY - result.emptyLayout.mainCenterY) <
                result.emptyLayout.mainHeight * 0.25 &&
              result.emptyLayout.shellHeight > result.emptyLayout.mainHeight * 0.6,
            {
              name: 'empty-composer-remains-centered',
              message: '空会话输入框必须位于主工作区中部，且居中容器占据可用高度。',
              data: result.emptyLayout
            }
          )
          await runtime.assertThat(
            result.sparseDragLayout !== null &&
              result.sparseDragLayout.appRegion === 'drag' &&
              result.sparseDragLayout.pointerEvents === 'auto' &&
              Math.round(result.sparseDragLayout.tabbarHeight) === 44 &&
              Math.round(result.sparseDragLayout.dragHeight) === 44 &&
              result.sparseDragLayout.dragWidth > 40 &&
              result.sparseDragLayout.hitTestId === workbenchSelectors.resourceTabDragRegion &&
              result.sparseDragLayout.dragRight <= result.sparseDragLayout.addLeft &&
              result.sparseDragLayout.addRight <= result.sparseDragLayout.toggleLeft &&
              result.denseDragLayout !== null &&
              result.denseDragLayout.appRegion === 'drag' &&
              result.denseDragLayout.dragWidth <= 1 &&
              result.denseDragLayout.scrollWidth > result.denseDragLayout.clientWidth &&
              result.recoveredDragLayout !== null &&
              result.recoveredDragLayout.dragWidth > 40 &&
              result.recoveredDragLayout.hitTestId === workbenchSelectors.resourceTabDragRegion &&
              windowsChromeSeparated,
            {
              name: 'right-panel-empty-space-is-dynamically-draggable',
              message:
                '右侧 Tab 后的空白区必须可拖拽；Tab 溢出时拖拽区应收缩，关闭 Tab 后应自动恢复，并位于 Windows 原生窗口层下方。',
              data: {
                sparse: result.sparseDragLayout,
                dense: result.denseDragLayout,
                recovered: result.recoveredDragLayout
              }
            }
          )
          await runtime.assertThat(
            result.fileMenuLabelVisible &&
              result.legacyFileMenuLabelCount === 0 &&
              result.tabCount === 8 &&
              Math.round(result.chromeLayout?.tabbarHeight ?? 0) === 44 &&
              result.chromeLayout.tabbarBorderBottom === '0px' &&
              result.chromeLayout.toggleInsideTabbar &&
              result.chromeLayout.toggleAppRegion === 'no-drag' &&
              result.chromeLayout.scrollWidth > result.chromeLayout.clientWidth &&
              result.chromeLayout.scrollLeft > 0,
            {
              name: 'right-panel-tabbar-is-compact-and-scrollable',
              message: '右侧 Tab 栏应为 44px、无下边线、折叠按钮位于栏内，并支持溢出横向滚动。',
              data: {
                fileMenuLabelVisible: result.fileMenuLabelVisible,
                legacyFileMenuLabelCount: result.legacyFileMenuLabelCount,
                tabCount: result.tabCount,
                chromeLayout: result.chromeLayout
              }
            }
          )
          await runtime.assertThat(
            result.browserMenuLayout.viewportBeforeMenu !== null &&
              result.browserMenuLayout.viewportDuringMenu !== null &&
              result.browserMenuLayout.viewportAfterMenu !== null &&
              result.browserMenuLayout.zoomBeforeMenu === 100 &&
              result.browserMenuLayout.zoomDuringMenu === 100 &&
              result.browserMenuLayout.zoomAfterMenu === 100 &&
              result.browserMenuLayout.nativeChildCountBeforeMenu > 0 &&
              result.browserMenuLayout.nativeChildCountDuringMenu ===
                result.browserMenuLayout.nativeChildCountBeforeMenu &&
              result.browserMenuLayout.menuStayedOpenAfterZoom &&
              result.browserMenuLayout.zoomControlBoxes.every((box) => box !== null) &&
              new Set(
                result.browserMenuLayout.zoomControlBoxes.map((box) => Math.round(box?.y || 0))
              ).size === 1 &&
              Math.abs(
                result.browserMenuLayout.viewportBeforeMenu.width -
                  result.browserMenuLayout.viewportDuringMenu.width
              ) < 1 &&
              Math.abs(
                result.browserMenuLayout.viewportBeforeMenu.height -
                  result.browserMenuLayout.viewportDuringMenu.height
              ) < 1 &&
              Math.abs(
                result.browserMenuLayout.viewportBeforeMenu.width -
                  result.browserMenuLayout.viewportAfterMenu.width
              ) < 1 &&
              Math.abs(
                result.browserMenuLayout.viewportBeforeMenu.height -
                  result.browserMenuLayout.viewportAfterMenu.height
              ) < 1 &&
              result.browserGoButtonVisible &&
              !result.hoverOverflow.horizontal &&
              !result.hoverOverflow.vertical &&
              result.restoreButtonRightOffset >= 0 &&
              result.restoreButtonRightOffset < 200,
            {
              name: 'browser-menu-and-panel-toggle-remain-operable',
              message:
                '浏览器原生菜单不得改变 viewport 或 zoom，浏览器侧栏折叠完成后应卸载 shell，恢复按钮应贴近右边缘。',
              data: {
                browserMenuLayout: result.browserMenuLayout,
                restoreButtonRightOffset: result.restoreButtonRightOffset,
                browserGoButtonVisible: result.browserGoButtonVisible,
                hoverOverflow: result.hoverOverflow,
                shellPresentDuringExit: result.shellPresentDuringExit
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 3
  )
})
