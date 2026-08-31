import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectScheduledTaskModel,
  selectScheduledTaskWorkspace,
  setupWorkbenchWithTempWorkspace
} from '../../../harness/e2e/workbench'
import type { ScheduledTask } from '../../../../src/shared/types'

const CASE_ID = 'scheduled-task-config-lifecycle'
const TASK_NAME = '定时任务生命周期'
const TASK_NAME_EDITED = '定时任务生命周期已编辑'
const TASK_PROMPT = '请只回复 ok。'

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

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
          '验证定时任务新增、必填校验、编辑、启用开关与删除闭环，且执行权限位于偏好下方。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createSession: false
          })

          await openScheduledTasksView(page)

          // 空表单保存应被拦截，不产生任务。
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          const saveButton = getWorkbenchLocator(page, scheduledTaskSelectors.formSave)
          await saveButton.waitFor({ state: 'visible' })
          await saveButton.click()
          const emptySaveBlocked = (await listTasks(page)).length === 0
          const formStillOpenAfterEmptySave = await saveButton.isVisible()

          // 补齐必填项并保存。
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPrompt).fill(TASK_PROMPT)
          await fillScheduledTaskTime(page, '09:05')
          await selectScheduledTaskWorkspace(page, setup.workspaceName)
          await selectScheduledTaskModel(page, setup.env.modelName)
          await saveButton.click()
          await saveButton.waitFor({ state: 'hidden' })

          const createdTasks = await listTasks(page)
          const created = createdTasks.find((task) => task.name === TASK_NAME)
          const createdCorrectly = Boolean(
            created &&
              !created.enabled &&
              created.scheduleType === 'daily' &&
              created.timeOfDay === '09:05' &&
              created.workspaceId &&
              created.mainModel.configId &&
              created.mainModel.modelName
          )
          const item = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemPrefix}-${created.id}`)
            : null
          const itemShowsSummary = item
            ? (await item.textContent())?.includes('每天 09:05') ?? false
            : false

          // 启用开关。
          const toggle = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemTogglePrefix}-${created.id}`)
            : null
          await toggle?.click()
          const enabledAfterToggle = created
            ? Boolean((await listTasks(page)).find((task) => task.id === created.id)?.enabled)
            : false

          // 编辑名称。
          if (item) {
            await item.getByRole('button', { name: '编辑' }).click()
            const nameInput = getWorkbenchLocator(page, scheduledTaskSelectors.formName)
            await nameInput.waitFor({ state: 'visible' })
            await nameInput.fill(TASK_NAME_EDITED)
            await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
          }
          const editedTasks = await listTasks(page)
          const editedCorrectly = editedTasks.some((task) => task.name === TASK_NAME_EDITED)

          // 删除并二次确认。
          const edited = editedTasks.find((task) => task.name === TASK_NAME_EDITED)
          if (edited) {
            const editedItem = getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemPrefix}-${edited.id}`
            )
            await editedItem
              .getByRole('button', { name: `删除 ${TASK_NAME_EDITED}` })
              .click()
            const confirmOk = page.locator('.ant-modal-confirm-btns .ant-btn-dangerous')
            await confirmOk.waitFor({ state: 'visible' })
            await confirmOk.click()
          }
          const deletedCorrectly = (await listTasks(page)).every(
            (task) => task.name !== TASK_NAME_EDITED
          )

          return {
            emptySaveBlocked,
            formStillOpenAfterEmptySave,
            createdCorrectly,
            itemShowsSummary,
            enabledAfterToggle,
            editedCorrectly,
            deletedCorrectly
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.emptySaveBlocked &&
              result.formStillOpenAfterEmptySave &&
              result.createdCorrectly &&
              result.itemShowsSummary &&
              result.enabledAfterToggle &&
              result.editedCorrectly &&
              result.deletedCorrectly,
            {
              name: 'scheduled-task-config-lifecycle',
              message:
                '定时任务新增、必填拦截、编辑、启用开关与删除应完整闭环，对齐 ST-FORM-001 / ST-SWITCH-001 / ST-DELETE-001 / ST-LIST-001。',
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
