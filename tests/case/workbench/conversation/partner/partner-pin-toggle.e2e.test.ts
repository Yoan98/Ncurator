import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-pin-toggle'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证伙伴置顶后排到最上方、图钉常驻，且没有「已置顶」分组文案。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const partners = await page.evaluate(async () => {
            const first = await window.api.partnerCreate({
              name: '置顶伙伴 A',
              avatar_shape: 'circle',
              avatar_color: 'blue'
            })
            const second = await window.api.partnerCreate({
              name: '置顶伙伴 B',
              avatar_shape: 'circle',
              avatar_color: 'green'
            })
            if (!first.success || !first.partner || !second.success || !second.partner) {
              throw new Error(first.error || second.error || 'partnerCreate failed')
            }
            return { first: first.partner, second: second.partner }
          })
          await page.reload()
          await navigateToWorkbench(page)

          const partnerA = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partners.first.id}`
          )
          const partnerB = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partners.second.id}`
          )
          await partnerA.waitFor({ state: 'visible' })
          await partnerB.waitFor({ state: 'visible' })
          const pinButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerPinButtonPrefix}-${partners.first.id}`
          )

          await partnerA.hover()
          await pinButton.click({ force: true })
          await page.mouse.move(0, 0)
          await pinButton.waitFor({ state: 'visible' })

          const list = getWorkbenchLocator(page, workbenchSelectors.partnersList)
          const firstItemId = await list
            .locator(`[data-testid^="${workbenchSelectors.partnerItemPrefix}-"]`)
            .first()
            .getAttribute('data-testid')
          const pinnedHeadingVisible = await page.getByText('已置顶', { exact: true }).isVisible()
          const pinVisibleWithoutHover = await pinButton.isVisible()

          await pinButton.click()
          await page.mouse.move(0, 0)
          const partnerVisibleAfterUnpin = await partnerA.isVisible()
          const pinHiddenAfterUnpin = !(await pinButton.isVisible().catch(() => false))

          return {
            firstItemId,
            expectedFirstTestId: `${workbenchSelectors.partnerItemPrefix}-${partners.first.id}`,
            pinnedHeadingVisible,
            pinVisibleWithoutHover,
            partnerVisibleAfterUnpin,
            pinHiddenAfterUnpin
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstItemId === result.expectedFirstTestId &&
              result.pinnedHeadingVisible === false &&
              result.pinVisibleWithoutHover &&
              result.partnerVisibleAfterUnpin &&
              result.pinHiddenAfterUnpin,
            {
              name: 'workbench-partner-pin-toggle',
              message:
                '置顶后应排到最上方且图钉常驻，不出现「已置顶」文案；取消后伙伴仍可见且图钉不再常驻。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
