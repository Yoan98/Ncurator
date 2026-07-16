import { describe, it } from 'vitest'
import { windowSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
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
          '验证空会话输入区、右侧动态 Tab 拖拽区、横向滚动、窗口按钮避让和浏览器缩放菜单。',
        fixtures: [],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })

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

          const initialPanelToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelToggle
          )
          const initialShellCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelShell
          ).count()
          if ((await initialPanelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await initialPanelToggle.click()
            await page.waitForFunction((testId) => {
              const shell = document.querySelector(`[data-testid="${testId}"]`)
              return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
            }, workbenchSelectors.contentPanelShell)
          }

          const addButton = getWorkbenchLocator(page, workbenchSelectors.resourceTabAddButton)
          await addButton.click()
          const fileMenuLabelVisible = await page
            .getByRole('menuitem', { name: '文件', exact: true })
            .isVisible()
          const legacyFileMenuLabelCount = await page
            .getByRole('menuitem', { name: '打开文件', exact: true })
            .count()
          await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()

          const tabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          await tabs.first().waitFor({ state: 'visible' })
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
                const controls = [
                  selectors.window.minimizeButton,
                  selectors.window.maximizeButton,
                  selectors.window.closeButton
                ]
                  .map((testId) => {
                    const element = document.querySelector(`[data-testid="${testId}"]`)
                    if (!(element instanceof HTMLElement)) return null
                    const rect = element.getBoundingClientRect()
                    return {
                      left: rect.left,
                      right: rect.right,
                      appRegion: getComputedStyle(element).getPropertyValue('-webkit-app-region'),
                      hitTestId:
                        document
                          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                          ?.closest<HTMLElement>('[data-testid]')?.dataset.testid || null
                    }
                  })
                  .filter((control): control is NonNullable<typeof control> => control !== null)

                return {
                  platform: navigator.userAgent.toLowerCase().includes('windows')
                    ? 'win32'
                    : 'other',
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
                  controls
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
            await addButton.click()
            await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()
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
            await addButton.click()
            await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()
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
          await browserPanel.getByRole('button', { name: '更多浏览器操作' }).click()
          const zoomControls = getWorkbenchLocator(page, workbenchSelectors.browserZoomControls)
          await zoomControls.waitFor({ state: 'visible' })
          const zoomLayout = await zoomControls.evaluate((element) =>
            [...element.querySelectorAll('button')].map((button) => {
              const rect = button.getBoundingClientRect()
              return {
                top: rect.top,
                bottom: rect.bottom,
                label: button.getAttribute('aria-label')
              }
            })
          )
          await page.keyboard.press('Escape')

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
            zoomLayout,
            browserGoButtonVisible,
            hoverOverflow,
            shellPresentDuringExit,
            restoreButtonRightOffset
          }
        },
        assert: async (result, runtime) => {
          const windowsControlsSafe =
            result.sparseDragLayout?.platform !== 'win32' ||
            (result.sparseDragLayout.controls.length === 3 &&
              result.sparseDragLayout.controls.every(
                (control) => control.appRegion === 'no-drag' && control.hitTestId !== null
              ) &&
              result.sparseDragLayout.toggleRight <= result.sparseDragLayout.controls[0].left)

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
              windowsControlsSafe,
            {
              name: 'right-panel-empty-space-is-dynamically-draggable',
              message:
                '右侧 Tab 后的空白区必须可拖拽；Tab 溢出时拖拽区应收缩，关闭 Tab 后应自动恢复，并避开 Windows 窗口按钮。',
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
              result.chromeLayout?.tabbarHeight === 44 &&
              result.chromeLayout.tabbarBorderBottom === '0px' &&
              result.chromeLayout.toggleInsideTabbar &&
              result.chromeLayout.toggleAppRegion === 'no-drag' &&
              result.chromeLayout.scrollWidth > result.chromeLayout.clientWidth &&
              result.chromeLayout.scrollLeft > 0,
            {
              name: 'right-panel-tabbar-is-compact-and-scrollable',
              message: '右侧 Tab 栏应为 44px、无下边线、折叠按钮位于栏内，并支持溢出横向滚动。',
              data: result.chromeLayout
            }
          )
          await runtime.assertThat(
            result.zoomLayout.length === 3 &&
              result.browserGoButtonVisible &&
              !result.hoverOverflow.horizontal &&
              !result.hoverOverflow.vertical &&
              result.shellPresentDuringExit &&
              result.zoomLayout.every(
                (button) =>
                  Math.abs(button.top - result.zoomLayout[0].top) < 1 &&
                  Math.abs(button.bottom - result.zoomLayout[0].bottom) < 1
              ) &&
              result.restoreButtonRightOffset >= 0 &&
              result.restoreButtonRightOffset < 200,
            {
              name: 'browser-menu-and-panel-toggle-remain-operable',
              message: '浏览器缩放必须在同一行，浮层需避让原生视图，折叠后恢复按钮应贴近右边缘。',
              data: {
                zoomLayout: result.zoomLayout,
                restoreButtonRightOffset: result.restoreButtonRightOffset
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 3
  )
})
