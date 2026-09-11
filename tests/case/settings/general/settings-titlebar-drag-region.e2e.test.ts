import { describe, it } from 'vitest'
import { settingsSelectors, windowSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

type DragRegionSnapshot = {
  platform: 'darwin' | 'win32'
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
  sidebarPanel: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  sidebarToggle: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  backRow: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  mainHitTestId: string | null
  sidebarHitTestId: string | null
  nativeChrome: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  nativeChromeDragRegion: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  windowContent: {
    appRegion: string
    pointerEvents: string
    rect: { x: number; y: number; width: number; height: number }
  } | null
  nativeChromeDragHitTestId: string | null
  sidebarToggleHitTestId: string | null
  viewportWidth: number
  sidebarCollapseRoundTrip: boolean
  addModalVisible: boolean
}

describe('settings general e2e', () => {
  it(
    'settings-titlebar-drag-region',
    async () => {
      await runE2ECase<DragRegionSnapshot>({
        caseId: 'settings-titlebar-drag-region',
        domain: 'settings',
        suite: 'general',
        description: '设置页窗口层与业务内容分层，拖动区不遮挡页面操作。',
        fixtures: [],
        serviceMode: 'real',
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

          const snapshot = await page.evaluate(
            (selectors) => {
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
              const sidebarPanel = readRegion(selectors.sidebar)
              const sidebarToggle = readRegion(selectors.sidebarToggle)
              const backRow = readRegion(selectors.backRow)
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
              const nativeChrome = readRegion(selectors.window.nativeChrome)
              const nativeChromeDragRegion = readRegion(selectors.window.nativeChromeDragRegion)
              const windowContent = readRegion(selectors.window.content)
              const nativeChromeDragHit = nativeChromeDragRegion
                ? document.elementFromPoint(
                    nativeChromeDragRegion.rect.x +
                      Math.max(1, Math.floor(nativeChromeDragRegion.rect.width / 2)),
                    nativeChromeDragRegion.rect.y +
                      Math.max(1, Math.floor(nativeChromeDragRegion.rect.height / 2))
                  )
                : null
              const sidebarToggleHit = sidebarToggle
                ? document.elementFromPoint(
                    sidebarToggle.rect.x + Math.floor(sidebarToggle.rect.width / 2),
                    sidebarToggle.rect.y + Math.floor(sidebarToggle.rect.height / 2)
                  )
                : null

              return {
                platform: navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin',
                viewportWidth: window.innerWidth,
                main,
                sidebar,
                sidebarPanel,
                sidebarToggle,
                backRow,
                mainHitTestId:
                  mainHit instanceof HTMLElement ? mainHit.dataset.testid || null : null,
                sidebarHitTestId:
                  sidebarHit instanceof HTMLElement ? sidebarHit.dataset.testid || null : null,
                nativeChrome,
                nativeChromeDragRegion,
                windowContent,
                nativeChromeDragHitTestId:
                  nativeChromeDragHit instanceof HTMLElement
                    ? nativeChromeDragHit.dataset.testid || null
                    : null,
                sidebarToggleHitTestId:
                  sidebarToggleHit instanceof Element
                    ? sidebarToggleHit.closest<HTMLElement>('[data-testid]')?.dataset.testid || null
                    : null,
                addModalVisible: false
              }
            },
            { ...settingsSelectors, window: windowSelectors }
          )

          let sidebarCollapseRoundTrip = true
          if (snapshot.platform === 'win32') {
            const sidebarToggle = getSettingsLocator(page, settingsSelectors.sidebarToggle)
            await sidebarToggle.click()
            await page.waitForFunction((testId) => {
              const sidebar = document.querySelector(`[data-testid="${testId}"]`)
              return sidebar instanceof HTMLElement && sidebar.getBoundingClientRect().width <= 1
            }, settingsSelectors.sidebar)
            await sidebarToggle.click()
            await page.waitForFunction((testId) => {
              const sidebar = document.querySelector(`[data-testid="${testId}"]`)
              return sidebar instanceof HTMLElement && sidebar.getBoundingClientRect().width > 100
            }, settingsSelectors.sidebar)
            sidebarCollapseRoundTrip = true
          }

          await runtime.step({
            name: 'verify-actions-not-blocked',
            message: '点击新增配置，确认顶部拖动层没有遮挡页面操作按钮。',
            run: async () => {
              await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
              // Ant Design 会把 data-testid 挂在 modal root 上，关闭时 root 仍在 DOM 但为 hidden。
              await getSettingsLocator(page, settingsSelectors.modelPresetProviderSelect).waitFor({
                state: 'visible'
              })
            }
          })

          return {
            ...snapshot,
            sidebarCollapseRoundTrip,
            addModalVisible: await getSettingsLocator(
              page,
              settingsSelectors.modelPresetProviderSelect
            ).isVisible()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.main?.appRegion === 'drag' &&
              result.main.pointerEvents === 'auto' &&
              result.main.rect.height === 44 &&
              result.mainHitTestId === settingsSelectors.mainDragRegion,
            {
              name: 'main-titlebar-hit-target-is-draggable',
              message:
                '设置页主内容顶部应命中 drag 区域，鼠标放在顶部条才能拖动窗口，对齐 SET-GENERAL-002-AC2。',
              data: result
            }
          )

          await runtime.assertThat(
            result.platform === 'win32' ||
              (result.sidebar?.appRegion === 'drag' &&
                result.sidebar.pointerEvents === 'auto' &&
                result.sidebar.rect.height === 44 &&
                result.sidebarHitTestId === settingsSelectors.sidebarDragRegion),
            {
              name: 'sidebar-titlebar-hit-target-is-draggable',
              message:
                '设置页侧栏顶部避开系统按钮后，也应保留可拖动窗口区域，对齐 SET-GENERAL-002-AC2。',
              data: result
            }
          )

          await runtime.assertThat(
            (() => {
              const nativeControlButtonWidth = result.nativeChromeDragRegion
                ? (result.viewportWidth -
                    (result.nativeChromeDragRegion.rect.x +
                      result.nativeChromeDragRegion.rect.width)) /
                  3
                : 0
              return (
                result.platform !== 'win32' ||
                (result.nativeChrome !== null &&
                  result.nativeChrome.rect.height === 36 &&
                  result.nativeChromeDragRegion?.appRegion === 'drag' &&
                  result.nativeChromeDragRegion.pointerEvents === 'auto' &&
                  result.nativeChromeDragHitTestId === windowSelectors.nativeChromeDragRegion &&
                  result.windowContent !== null &&
                  result.windowContent.rect.y >=
                    result.nativeChrome.rect.y + result.nativeChrome.rect.height &&
                  result.main !== null &&
                  result.main.rect.y >= result.windowContent.rect.y &&
                  result.sidebarPanel !== null &&
                  result.sidebarPanel.rect.y === result.windowContent.rect.y &&
                  result.sidebarToggle?.appRegion === 'no-drag' &&
                  result.sidebarToggleHitTestId === settingsSelectors.sidebarToggle &&
                  result.sidebarToggle.rect.x === 0 &&
                  result.sidebarToggle.rect.y === 0 &&
                  result.sidebarToggle.rect.height === 36 &&
                  Math.abs(result.sidebarToggle.rect.width - nativeControlButtonWidth) < 2 &&
                  result.backRow !== null &&
                  result.backRow.rect.y - result.windowContent.rect.y < 20 &&
                  result.sidebarCollapseRoundTrip)
              )
            })(),
            {
              name: 'windows-native-titlebar-is-separated-from-settings',
              message:
                'Windows 原生窗口按钮层必须独立位于设置页业务内容上方，对齐 SET-GENERAL-002-AC1。',
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
    },
    SETTINGS_E2E_TIMEOUT_MS * 3
  )
})
