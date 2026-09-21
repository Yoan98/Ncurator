import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectWorkbenchModel,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import type { PartnerListItem, ScheduledTask } from '../../../../src/shared/types'

const CASE_ID = 'scheduled-task-config-lifecycle'
const PARTNER_NAME = '生命周期伙伴'
const TASK_NAME = '定时任务生命周期'
const TASK_NAME_EDITED = '定时任务生命周期已编辑'
const TASK_PROMPT = '请只回复 ok。'

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

const listPartners = async (page: import('playwright').Page): Promise<PartnerListItem[]> =>
  (await page.evaluate(async () => await window.api.partnerList())) as PartnerListItem[]

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description:
          '验证定时任务新增、伙伴必填、默认开启、编辑保存不改启用、立即执行确认与删除闭环。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createPartner: false
          })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await selectWorkbenchModel(page, setup.env.modelName)
          const partnersBefore = await listPartners(page)

          await openScheduledTasksView(page)

          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          const saveButton = getWorkbenchLocator(page, scheduledTaskSelectors.formSave)
          await saveButton.waitFor({ state: 'visible' })
          await saveButton.click()
          const emptySaveBlocked = (await listTasks(page)).length === 0
          const formStillOpenAfterEmptySave = await saveButton.isVisible()

          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPrompt).fill(TASK_PROMPT)
          await fillScheduledTaskTime(page, '09:05')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPartner).click()
          await page.getByRole('option', { name: PARTNER_NAME, exact: true }).click()
          await saveButton.click()
          await saveButton.waitFor({ state: 'hidden' })

          const createdTasks = await listTasks(page)
          const created = createdTasks.find((task) => task.name === TASK_NAME)
          const partnersAfterCreate = await listPartners(page)
          const createdCorrectly = Boolean(
            created &&
              created.enabled &&
              created.scheduleType === 'daily' &&
              created.timeOfDay === '09:05' &&
              created.partnerId === partnersBefore[0]?.id &&
              partnersAfterCreate.length === partnersBefore.length &&
              !partnersAfterCreate.some((partner) => partner.name === `定时 · ${TASK_NAME}`)
          )
          const item = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemPrefix}-${created.id}`)
            : null
          const itemShowsSummary = item
            ? ((await item.textContent())?.includes('每天 09:05') ?? false)
            : false

          const runNowButton = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemRunNowPrefix}-${created.id}`)
            : null
          await runNowButton?.click()
          const confirmOk = page.locator('.ant-modal-confirm-btns .ant-btn-primary')
          await confirmOk.waitFor({ state: 'visible' })
          await page.locator('.ant-modal-confirm-btns .ant-btn-default').click()
          const partnersAfterRunNowCancel = await listPartners(page)
          const runNowConfirmCancelKeptIdle =
            partnersAfterRunNowCancel.length === partnersBefore.length &&
            !partnersAfterRunNowCancel.some((partner) => partner.isRunning)

          const toggle = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemTogglePrefix}-${created.id}`)
            : null
          await toggle?.click()
          const disabledAfterToggle = created
            ? !(await listTasks(page)).find((task) => task.id === created.id)?.enabled
            : false
          await toggle?.click()
          const enabledAfterToggle = created
            ? Boolean((await listTasks(page)).find((task) => task.id === created.id)?.enabled)
            : false
          const sidebarCountChip = getWorkbenchLocator(
            page,
            workbenchSelectors.scheduledTasksCountChip
          )
          const titleCountChip = getWorkbenchLocator(page, scheduledTaskSelectors.countChip)
          const countChipVisibleAfterEnable =
            enabledAfterToggle &&
            (await sidebarCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await sidebarCountChip.textContent())?.trim() === '1' &&
            (await titleCountChip.textContent())?.trim() === '1'

          if (item && created) {
            await getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemEditPrefix}-${created.id}`
            ).click()
            const nameInput = getWorkbenchLocator(page, scheduledTaskSelectors.formName)
            await nameInput.waitFor({ state: 'visible' })
            await nameInput.fill(TASK_NAME_EDITED)
            await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
            await nameInput.waitFor({ state: 'hidden' })
          }
          const editedTasks = await listTasks(page)
          const edited = editedTasks.find((task) => task.name === TASK_NAME_EDITED)
          const editedCorrectly = Boolean(edited?.enabled)
          const countChipVisibleAfterEdit =
            Boolean(edited?.enabled) &&
            (await sidebarCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await sidebarCountChip.textContent())?.trim() === '1' &&
            (await titleCountChip.textContent())?.trim() === '1'

          if (edited) {
            const editedItem = getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemPrefix}-${edited.id}`
            )
            await editedItem.getByRole('button', { name: `删除 ${TASK_NAME_EDITED}` }).click()
            const deleteOk = page.locator('.ant-modal-confirm-btns .ant-btn-dangerous')
            await deleteOk.waitFor({ state: 'visible' })
            await deleteOk.click()
          }
          const deletedCorrectly = (await listTasks(page)).every(
            (task) => task.name !== TASK_NAME_EDITED
          )
          const countChipHiddenAfterDelete =
            (await sidebarCountChip
              .waitFor({ state: 'hidden' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'hidden' })
              .then(() => true)
              .catch(() => false))

          return {
            emptySaveBlocked,
            formStillOpenAfterEmptySave,
            createdCorrectly,
            itemShowsSummary,
            runNowConfirmCancelKeptIdle,
            disabledAfterToggle,
            enabledAfterToggle,
            countChipVisibleAfterEnable,
            editedCorrectly,
            countChipVisibleAfterEdit,
            deletedCorrectly,
            countChipHiddenAfterDelete
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.emptySaveBlocked &&
              result.formStillOpenAfterEmptySave &&
              result.createdCorrectly &&
              result.itemShowsSummary &&
              result.runNowConfirmCancelKeptIdle &&
              result.enabledAfterToggle &&
              result.countChipVisibleAfterEnable &&
              result.editedCorrectly &&
              result.countChipVisibleAfterEdit &&
              result.deletedCorrectly &&
              result.countChipHiddenAfterDelete,
            {
              name: 'scheduled-task-config-lifecycle',
              message:
                '定时任务新增、保存不建伙伴、必填拦截、编辑、启用、立即执行确认、数量 chip 与删除应完整闭环。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
