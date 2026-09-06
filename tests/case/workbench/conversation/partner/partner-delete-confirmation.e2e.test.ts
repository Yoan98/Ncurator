import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-delete-confirmation'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证伙伴删除确认，以及取消和确认删除。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            configureModel: false
          })
          const selectedPartner = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.partnerItemPrefix
          )
            .filter({ hasText: setup.workspaceName })
            .first()
          await selectedPartner.waitFor({ state: 'visible' })
          const selectedPartnerTestId = await selectedPartner.getAttribute('data-testid')
          const partnerId = selectedPartnerTestId?.replace(
            `${workbenchSelectors.partnerItemPrefix}-`,
            ''
          )
          if (!partnerId || partnerId === selectedPartnerTestId) {
            throw new Error('failed to read created partner id from UI')
          }

          const deleteButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerDeleteButtonPrefix}-${partnerId}`
          )
          const confirmButton = getWorkbenchLocator(
            page,
            workbenchSelectors.partnerDeleteConfirmButton
          )
          const cancelButton = getWorkbenchLocator(
            page,
            workbenchSelectors.partnerDeleteCancelButton
          )
          await selectedPartner.hover()
          await deleteButton.click()
          await confirmButton.waitFor({ state: 'visible' })
          await cancelButton.click()
          await confirmButton.waitFor({ state: 'hidden' })
          const partnerStillExistsAfterCancel = await selectedPartner.isVisible().catch(() => false)

          await selectedPartner.hover()
          await deleteButton.click()
          await confirmButton.waitFor({ state: 'visible' })
          await confirmButton.click()
          await confirmButton.waitFor({ state: 'hidden' })
          const partnerRemovedAfterConfirm = await selectedPartner
            .waitFor({ state: 'detached', timeout: 10_000 })
            .then(() => true)
            .catch(async () => !(await selectedPartner.isVisible().catch(() => false)))

          return {
            partnerStillExistsAfterCancel,
            partnerRemovedAfterConfirm
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.partnerStillExistsAfterCancel && result.partnerRemovedAfterConfirm,
            {
              name: 'workbench-partner-delete-confirmation',
              message: 'Workbench 伙伴删除必须先确认，取消不删除，确认后删除。',
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
