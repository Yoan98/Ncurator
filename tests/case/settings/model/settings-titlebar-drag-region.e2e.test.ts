import { describe, it } from 'vitest'
import {
  settingsSelectors,
  windowSelectors
} from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

type DragRegionSnapshot = {
  main: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  sidebar: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  mainHitTestId: string | null
  sidebarHitTestId: string | null
  windowButtonHitTestId: string | null
  windowButton: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  addModalVisible: boolean
}

describe('settings model e2e', () => {
  it('settings-titlebar-drag-region', async () => {
    await runE2ECase<DragRegionSnapshot>({
      caseId: 'settings-titlebar-drag-region',
      domain: 'settings',
      suite: 'model',
      description: '设置页顶部区域提供 Electron 窗口拖动区，且不遮挡页面按钮。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'open-model-settings',
          message: '进入大模型设置页。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await getSettingsLocator(page, settingsSelectors.mainDragRegion).waitFor({
              state: 'visible'
            })
          }
        })

        const snapshot = await page.evaluate((selectors) => {
          const readRegion = (testId: string) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            if (!(element instanceof HTMLElement)) return null
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            return {
              appRegion: style.getPropertyValue('-webkit-app-region'),
              pointerEvents: style.pointerEvents,
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            }
          }

          const main = readRegion(selectors.mainDragRegion)
          const sidebar = readRegion(selectors.sidebarDragRegion)
          const mainHit = main
            ? document.elementFromPoint(
                main.rect.x + Math.min(120, Math.floor(main.rect.width / 2)),
                main.rect.y + 10
              )
            : null
          const sidebarHit = sidebar
            ? document.elementFromPoint(
                sidebar.rect.x + Math.min(120, Math.floor(sidebar.rect.width / 2)),
                sidebar.rect.y + 10
              )
            : null
          const windowButton = readRegion(selectors.window.closeButton)
          const windowButtonHit = windowButton
            ? document.elementFromPoint(
                windowButton.rect.x + Math.floor(windowButton.rect.width / 2),
                windowButton.rect.y + Math.floor(windowButton.rect.height / 2)
              )
            : null

          return {
            main,
            sidebar,
            mainHitTestId: mainHit instanceof HTMLElement ? mainHit.dataset.testid || null : null,
            sidebarHitTestId:
              sidebarHit instanceof HTMLElement ? sidebarHit.dataset.testid || null : null,
            windowButton,
            windowButtonHitTestId:
              windowButtonHit instanceof HTMLElement ? windowButtonHit.dataset.testid || null : null,
            addModalVisible: false
          }
        }, { ...settingsSelectors, window: windowSelectors })

        await runtime.step({
          name: 'verify-actions-not-blocked',
          message: '点击新增配置，确认顶部拖动层没有遮挡页面操作按钮。',
          run: async () => {
            await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
            await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
              state: 'visible'
            })
          }
        })

        return {
          ...snapshot,
          addModalVisible: await getSettingsLocator(
            page,
            settingsSelectors.modelBaseUrlInput
          ).isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.main?.appRegion === 'drag' &&
            result.main.pointerEvents === 'auto' &&
            result.main.rect.height === 52 &&
            result.mainHitTestId === settingsSelectors.mainDragRegion,
          {
            name: 'main-titlebar-hit-target-is-draggable',
            message: '设置页主内容顶部应命中 drag 区域，鼠标放在顶部条才能拖动窗口。',
            data: result
          }
        )

        await runtime.assertThat(
          result.sidebar?.appRegion === 'drag' &&
            result.sidebar.pointerEvents === 'auto' &&
            result.sidebar.rect.height === 52 &&
            result.sidebarHitTestId === settingsSelectors.sidebarDragRegion,
          {
            name: 'sidebar-titlebar-hit-target-is-draggable',
            message: '设置页侧栏顶部避开系统按钮后，也应保留可拖动窗口区域。',
            data: result
          }
        )

        await runtime.assertThat(
          result.windowButton?.appRegion === 'no-drag' &&
            result.windowButton.pointerEvents !== 'none' &&
            result.main !== null &&
            result.main.rect.x + result.main.rect.width <= result.windowButton.rect.x &&
            (result.windowButtonHitTestId === windowSelectors.closeButton ||
              result.windowButtonHitTestId === null),
          {
            name: 'windows-titlebar-buttons-are-not-covered-by-drag-region',
            message: 'Windows 右上角窗口按钮所在区域不能被设置页拖拽层覆盖。',
            data: result
          }
        )

        await runtime.assertThat(result.addModalVisible, {
          name: 'settings-actions-remain-clickable',
          message: '设置页顶部拖动层不能遮挡大模型设置里的新增配置按钮。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 3)
})
