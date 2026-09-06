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
        description: '验证伙伴置顶与取消置顶，以及「已置顶」区域显隐。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const partner = await page.evaluate(async () => {
            const response = await window.api.partnerCreate({
              name: '置顶切换测试伙伴',
              avatar_shape: 'circle',
              avatar_color: 'blue'
            })
            if (!response.success || !response.partner) {
              throw new Error(response.error || 'partnerCreate failed')
            }
            return response.partner
          })
          await page.reload()
          await navigateToWorkbench(page)

          const partnerItem = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          )
          await partnerItem.waitFor({ state: 'visible' })
          const pinButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerPinButtonPrefix}-${partner.id}`
          )
          const pinnedSection = getWorkbenchLocator(page, workbenchSelectors.pinnedPartnersSection)

          await partnerItem.hover()
          await pinButton.click({ force: true })
          await pinnedSection.waitFor({ state: 'visible' })
          const pinnedContainsPartner = await pinnedSection
            .locator(`[data-testid="${workbenchSelectors.partnerItemPrefix}-${partner.id}"]`)
            .isVisible()

          await partnerItem.hover()
          await pinButton.click({ force: true })
          await page
            .locator(`[data-testid="${workbenchSelectors.pinnedPartnersSection}"]`)
            .waitFor({ state: 'detached', timeout: 10_000 })
          const pinnedHiddenAfterUnpin = !(await pinnedSection.isVisible().catch(() => false))
          const partnerVisibleAfterUnpin = await partnerItem.isVisible()

          return {
            pinnedContainsPartner,
            pinnedHiddenAfterUnpin,
            partnerVisibleAfterUnpin
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pinnedContainsPartner &&
              result.pinnedHiddenAfterUnpin &&
              result.partnerVisibleAfterUnpin,
            {
              name: 'workbench-partner-pin-toggle',
              message: '置顶后应出现在「已置顶」；取消后该区域隐藏且伙伴仍可见。',
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
