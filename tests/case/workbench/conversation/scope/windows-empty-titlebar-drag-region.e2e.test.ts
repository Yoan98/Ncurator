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
  rect: { x: number; y: number; width: number; height: number; right: number }
  hitTestId: string | null
}

type EmptyTitlebarSnapshot = {
  platform: 'darwin' | 'win32' | 'other'
  dragRegion: RegionSnapshot | null
  windowControls: RegionSnapshot[]
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
        description:
          'The empty conversation drag region stays outside the custom Windows window controls.',
        fixtures: [],
        runMode: 'single',
        execute: async ({ page }) => {
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await getWorkbenchLocator(page, workbenchSelectors.emptyDragRegion).waitFor({
            state: 'visible'
          })

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
                    right: rect.right
                  },
                  hitTestId: hitTarget?.dataset.testid || null
                }
              }

              const userAgent = navigator.userAgent.toLowerCase()
              const platform = userAgent.includes('windows')
                ? 'win32'
                : userAgent.includes('macintosh')
                  ? 'darwin'
                  : 'other'

              return {
                platform,
                dragRegion: readRegion(selectors.emptyDragRegion),
                windowControls: [
                  selectors.window.minimizeButton,
                  selectors.window.maximizeButton,
                  selectors.window.closeButton
                ]
                  .map(readRegion)
                  .filter((region): region is RegionSnapshot => region !== null)
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
              (result.windowControls.length === 3 &&
                result.windowControls.every(
                  (control) =>
                    control.appRegion === 'no-drag' &&
                    control.pointerEvents !== 'none' &&
                    control.hitTestId !== null
                ) &&
                result.dragRegion !== null &&
                result.dragRegion.rect.right <= result.windowControls[0].rect.x),
            {
              name: 'windows-controls-are-outside-empty-drag-region',
              message:
                'The empty conversation drag target must end before all three Windows controls.',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 2
  )
})
