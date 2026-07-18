import { describe, it } from 'vitest'
import { windowSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

type RegionSnapshot = {
  appRegion: string
  pointerEvents: string
  rect: {
    x: number
    y: number
    width: number
    height: number
    right: number
    bottom: number
  }
  hitTestId: string | null
}

type EmptyTitlebarSnapshot = {
  platform: 'darwin' | 'win32' | 'other'
  dragRegion: RegionSnapshot | null
  nativeChrome: RegionSnapshot | null
  nativeChromeDragRegion: RegionSnapshot | null
  windowContent: RegionSnapshot | null
  sessionsToggle: RegionSnapshot | null
  sidebarBrand: RegionSnapshot | null
  brandIconLeft: number | null
  newSessionIconLeft: number | null
  viewportWidth: number
  overlay: {
    visible: boolean
    rect: { x: number; y: number; width: number; height: number }
  } | null
}

describe('workbench conversation e2e', () => {
  it(
    'windows-empty-titlebar-drag-region',
    async () => {
      await runE2ECase<EmptyTitlebarSnapshot>({
        caseId: 'windows-empty-titlebar-drag-region',
        domain: 'workbench',
        suite: 'conversation',
        groups: ['scope'],
        description: 'Windows uses a native controls overlay above the shared application content.',
        fixtures: [],
        runMode: 'single',
        execute: async ({ page }) => {
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await getWorkbenchLocator(page, workbenchSelectors.emptyDragRegion).waitFor({
            state: 'visible'
          })
          const isWindows = await page.evaluate(() =>
            navigator.userAgent.toLowerCase().includes('windows')
          )
          if (isWindows) {
            await getWorkbenchLocator(page, workbenchSelectors.sidebarBrand).waitFor({
              state: 'visible'
            })
          }

          return await page.evaluate(
            (selectors) => {
              const readRegion = (testId: string): RegionSnapshot | null => {
                const element = document.querySelector(`[data-testid="${testId}"]`)
                if (!(element instanceof HTMLElement)) return null
                const rect = element.getBoundingClientRect()
                const style = window.getComputedStyle(element)
                const hit = document.elementFromPoint(
                  rect.x + Math.max(1, Math.floor(rect.width / 2)),
                  rect.y + Math.max(1, Math.floor(rect.height / 2))
                )
                const hitTarget =
                  hit instanceof Element ? hit.closest<HTMLElement>('[data-testid]') : null

                return {
                  appRegion: style.getPropertyValue('-webkit-app-region'),
                  pointerEvents: style.pointerEvents,
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    right: rect.right,
                    bottom: rect.bottom
                  },
                  hitTestId: hitTarget?.dataset.testid || null
                }
              }

              const overlayApi = (
                navigator as unknown as {
                  windowControlsOverlay?: {
                    visible: boolean
                    getTitlebarAreaRect: () => DOMRect
                  }
                }
              ).windowControlsOverlay
              const overlayRect = overlayApi?.getTitlebarAreaRect()

              const userAgent = navigator.userAgent.toLowerCase()
              const platform = userAgent.includes('windows')
                ? 'win32'
                : userAgent.includes('macintosh')
                  ? 'darwin'
                  : 'other'
              const sidebarBrand = document.querySelector(
                `[data-testid="${selectors.sidebarBrand}"]`
              )
              const brandIcon = sidebarBrand?.querySelector('img')
              const newSessionButton = document.querySelector(
                `[data-testid="${selectors.newSessionButton}"]`
              )
              const newSessionIcon = newSessionButton?.querySelector('svg')

              return {
                platform,
                viewportWidth: window.innerWidth,
                dragRegion: readRegion(selectors.emptyDragRegion),
                nativeChrome: readRegion(selectors.window.nativeChrome),
                nativeChromeDragRegion: readRegion(selectors.window.nativeChromeDragRegion),
                windowContent: readRegion(selectors.window.content),
                sessionsToggle: readRegion(selectors.sessionsToggle),
                sidebarBrand: readRegion(selectors.sidebarBrand),
                brandIconLeft:
                  brandIcon instanceof SVGElement || brandIcon instanceof HTMLElement
                    ? brandIcon.getBoundingClientRect().left
                    : null,
                newSessionIconLeft:
                  newSessionIcon instanceof SVGElement || newSessionIcon instanceof HTMLElement
                    ? newSessionIcon.getBoundingClientRect().left
                    : null,
                overlay:
                  overlayApi && overlayRect
                    ? {
                        visible: overlayApi.visible,
                        rect: {
                          x: overlayRect.x,
                          y: overlayRect.y,
                          width: overlayRect.width,
                          height: overlayRect.height
                        }
                      }
                    : null
              }
            },
            { ...workbenchSelectors, window: windowSelectors }
          )
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.dragRegion?.appRegion === 'drag' &&
              result.dragRegion.pointerEvents === 'auto' &&
              Math.round(result.dragRegion.rect.height) === 44 &&
              result.dragRegion.hitTestId === workbenchSelectors.emptyDragRegion,
            {
              name: 'empty-titlebar-remains-draggable',
              message: 'The empty conversation must retain a usable 44px window drag target.',
              data: result
            }
          )

          await runtime.assertThat(
            result.platform !== 'win32' ||
              (result.nativeChrome !== null &&
                Math.round(result.nativeChrome.rect.height) === 36 &&
                result.nativeChromeDragRegion?.appRegion === 'drag' &&
                result.nativeChromeDragRegion.pointerEvents === 'auto' &&
                result.nativeChromeDragRegion.hitTestId ===
                  windowSelectors.nativeChromeDragRegion &&
                result.windowContent !== null &&
                result.windowContent.rect.y >= result.nativeChrome.rect.bottom &&
                result.dragRegion !== null &&
                result.dragRegion.rect.y >= result.windowContent.rect.y &&
                result.overlay?.visible === true &&
                Math.round(result.overlay.rect.height) === 36),
            {
              name: 'windows-native-chrome-is-separated-from-app-content',
              message:
                'Windows native controls must occupy a dedicated 36px overlay above application content.',
              data: result
            }
          )

          const nativeControlButtonWidth = result.overlay
            ? (result.viewportWidth - (result.overlay.rect.x + result.overlay.rect.width)) / 3
            : 0
          await runtime.assertThat(
            result.platform !== 'win32' ||
              (result.sessionsToggle?.appRegion === 'no-drag' &&
                result.sessionsToggle.hitTestId === workbenchSelectors.sessionsToggle &&
                Math.abs(result.sessionsToggle.rect.x) < 1 &&
                Math.abs(result.sessionsToggle.rect.y) < 1 &&
                Math.abs(result.sessionsToggle.rect.height - 36) < 1 &&
                Math.abs(result.sessionsToggle.rect.width - nativeControlButtonWidth) < 2 &&
                result.sidebarBrand !== null &&
                result.windowContent !== null &&
                Math.abs(result.sidebarBrand.rect.y - result.windowContent.rect.y) < 1 &&
                Math.abs(result.sidebarBrand.rect.height - 36) < 1 &&
                result.brandIconLeft !== null &&
                result.newSessionIconLeft !== null &&
                Math.abs(result.brandIconLeft - result.newSessionIconLeft) < 1),
            {
              name: 'windows-sidebar-toggle-and-brand-are-aligned',
              message:
                'The Windows sidebar toggle must mirror native control spacing, while the brand aligns with sidebar actions.',
              data: {
                sessionsToggle: result.sessionsToggle,
                nativeControlButtonWidth,
                sidebarBrand: result.sidebarBrand,
                brandIconLeft: result.brandIconLeft,
                newSessionIconLeft: result.newSessionIconLeft
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 2
  )
})
