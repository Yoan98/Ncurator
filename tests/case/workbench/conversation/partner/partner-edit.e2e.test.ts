import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  waitForVisiblePartnerRow,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-edit'
const ORIGINAL_NAME = '编辑前伙伴'
const UPDATED_NAME = '编辑后伙伴'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证侧栏编辑入口复用创建弹窗，保存后更新名称与形象且不新建伙伴。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, ORIGINAL_NAME)
          const created = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === ORIGINAL_NAME
          )
          if (!created) throw new Error('created partner missing')
          await waitForVisiblePartnerRow(page, ORIGINAL_NAME)

          const partnerItem = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${created.id}`
          )
          const editButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerEditButtonPrefix}-${created.id}`
          )
          await partnerItem.hover()
          await editButton.click({ force: true })

          const nameInput = getWorkbenchLocator(page, workbenchSelectors.createPartnerNameInput)
          await nameInput.waitFor({ state: 'visible' })
          const modal = nameInput.locator('xpath=ancestor::div[contains(@class,"ant-modal")]')
          const modalTitle = ((await modal.locator('.ant-modal-title').textContent()) || '').trim()
          const prefilledName = await nameInput.inputValue()
          await nameInput.fill(UPDATED_NAME)
          await modal.getByRole('button', { name: 'pill' }).click()
          await modal.locator('.ant-modal-footer .ant-btn-primary').click()
          await waitForVisiblePartnerRow(page, UPDATED_NAME)

          const updated = await page.evaluate(async (partnerId) => {
            const partners = await window.api.partnerList()
            return {
              count: partners.length,
              partner: partners.filter((item) => item.id === partnerId).map(({id, name, avatar_shape}) => ({id, name, avatar_shape}))[0] || null
            }
          }, created.id)
          const listText = (
            (await getWorkbenchLocator(page, workbenchSelectors.partnersList).textContent()) || ''
          ).trim()

          return {
            modalTitle,
            prefilledName,
            updated,
            listText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.modalTitle === '编辑伙伴' &&
              result.prefilledName === ORIGINAL_NAME &&
              result.updated.count === 1 &&
              result.updated.partner?.name === UPDATED_NAME &&
              result.updated.partner.avatar_shape === 'pill' &&
              result.listText.includes(UPDATED_NAME) &&
              !result.listText.includes(ORIGINAL_NAME),
            {
              name: 'workbench-partner-edit',
              message: '编辑弹窗应预填原值，保存后仍是同一伙伴且侧栏显示新名称。',
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
