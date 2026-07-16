import { describe, it } from 'vitest'
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
          '验证空会话输入区、右侧折叠入口、资源 Tab 横向滚动、紧凑工具栏和浏览器缩放菜单。',
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
          for (let index = 0; index < 7; index += 1) {
            await addButton.click()
            await page.getByRole('menuitem', { name: '浏览器', exact: true }).click()
          }

          const tabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
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

          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell === null
          }, workbenchSelectors.contentPanelShell)
          const restoreButtonRightOffset = await getWorkbenchLocator(
            page,
            workbenchSelectors.contentPanelToggle
          ).evaluate((element) => window.innerWidth - element.getBoundingClientRect().right)
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()

          return {
            emptyLayout,
            initialShellCount,
            fileMenuLabelVisible,
            legacyFileMenuLabelCount,
            tabCount: await tabs.count(),
            chromeLayout,
            zoomLayout,
            browserGoButtonVisible,
            restoreButtonRightOffset
          }
        },
        assert: async (result, runtime) => {
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
