import { describe, it } from 'vitest'
import type { PartnerListItem, ScheduledTask } from '../../../../src/shared/types'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchPartnerDeleteConfirmation,
  getWorkbenchLocator,
  fillScheduledTaskTime,
  setWorkbenchInput,
  openWorkbenchPartnerDeleteConfirmation,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectScheduledTaskPartner,
  setupWorkbenchWithTempWorkspace,
  waitForScheduledTaskDrawerClosed,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-partner-deletion'

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description: '验证删除伙伴后任务保留、解绑停用，且可编辑重新绑定。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createPartner: false,
            configureModel: false
          })
          await createPartnerThroughWorkbenchUi(page, '待删除伙伴')
          await createPartnerThroughWorkbenchUi(page, '重新绑定伙伴')
          const partners = (await page.evaluate(
            async () => await window.api.partnerList()
          )) as PartnerListItem[]
          const removedPartner = partners.find((item) => item.name === '待删除伙伴')
          const reboundPartner = partners.find((item) => item.name === '重新绑定伙伴')
          if (!removedPartner || !reboundPartner) throw new Error('failed to create partners')
          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('伙伴删除保留任务')
          await setWorkbenchInput(
            page,
            '验证删除伙伴后的任务状态',
            scheduledTaskSelectors.formDescriptionInput
          )
          await selectScheduledTaskPartner(page, removedPartner.id)
          await fillScheduledTaskTime(page, '09:00')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
          await waitForScheduledTaskDrawerClosed(page)
          const task = (await page.evaluate(() => window.api.scheduledTaskList())).find(
            (item) => item.name === '伙伴删除保留任务'
          )
          if (!task) throw new Error('saved task missing')
          const taskId = task.id

          const removedItem = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${removedPartner.id}`
          )
          const deleteConfirmation = await openWorkbenchPartnerDeleteConfirmation(
            runtime,
            removedPartner.id
          )
          await dismissWorkbenchPartnerDeleteConfirmation(deleteConfirmation, 'confirm')
          await removedItem.waitFor({ state: 'detached' })

          const tasksAfterDelete = (await page.evaluate(
            async () => await window.api.scheduledTaskList()
          )) as ScheduledTask[]
          const retained = tasksAfterDelete.find((task) => task.id === taskId)
          const item = getWorkbenchLocator(page, `${scheduledTaskSelectors.itemPrefix}-${taskId}`)
          await item.waitFor({ state: 'visible' })
          const itemText = (await item.textContent()) || ''
          const toggle = getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemTogglePrefix}-${taskId}`
          )
          const toggleDisabled = await toggle.isDisabled()

          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemEditPrefix}-${taskId}`
          ).click()
          await selectScheduledTaskPartner(page, reboundPartner.id)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
          await waitForScheduledTaskDrawerClosed(page)
          const rebound = (
            (await page.evaluate(
              async () => await window.api.scheduledTaskList()
            )) as ScheduledTask[]
          ).find((task) => task.id === taskId)

          return {
            retainedAfterDelete: Boolean(
              retained && !retained.partnerId && !retained.enabled && retained.nextRunAt === null
            ),
            itemShowsUnbound: itemText.includes('未绑定 / 已停用'),
            toggleDisabled,
            reboundPreservesDisabled: Boolean(
              rebound?.partnerId === reboundPartner.id && rebound.enabled === false
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.retainedAfterDelete &&
              result.itemShowsUnbound &&
              result.toggleDisabled &&
              result.reboundPreservesDisabled,
            {
              name: 'scheduled-task-survives-partner-deletion',
              message: '删除伙伴后任务应保留、解绑停用且不可启用，重新绑定时仍保持停用。',
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
