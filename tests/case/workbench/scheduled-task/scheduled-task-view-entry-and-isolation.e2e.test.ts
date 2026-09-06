import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  scheduledTaskSelectors,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-view-entry-and-isolation'

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
          '验证左侧栏「定时任务」入口位于「创建伙伴」下方，点击后主区整块切换为定时任务视图且无聊天，再点「创建伙伴」返回聊天并打开创建弹窗。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, '定时任务视图伙伴')

          const scheduledButton = getWorkbenchLocator(page, workbenchSelectors.scheduledTasksButton)
          await scheduledButton.waitFor({ state: 'visible' })

          const inputLocator = getWorkbenchLocator(page, workbenchSelectors.input)
          await inputLocator.waitFor({ state: 'visible' })

          await scheduledButton.click()
          const view = getWorkbenchLocator(page, scheduledTaskSelectors.view)
          await view.waitFor({ state: 'visible' })
          const inputHiddenInScheduledView = await inputLocator
            .waitFor({ state: 'hidden' })
            .then(() => true)
            .catch(() => false)

          await getWorkbenchLocator(page, workbenchSelectors.newPartnerButton).click()
          await getWorkbenchLocator(page, workbenchSelectors.createPartnerNameInput).waitFor({
            state: 'visible'
          })
          await inputLocator.waitFor({ state: 'visible' })
          const viewHiddenAfterCreatePartner = await view
            .waitFor({ state: 'hidden' })
            .then(() => true)
            .catch(() => false)

          return {
            inputHiddenInScheduledView,
            viewHiddenAfterCreatePartner
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.inputHiddenInScheduledView && result.viewHiddenAfterCreatePartner,
            {
              name: 'scheduled-task-view-entry-and-isolation',
              message:
                '定时任务入口应位于创建伙伴下方，点击后整块主区切换为定时任务视图且无聊天，点创建伙伴返回聊天并打开创建弹窗，对齐 ST-ENTRY-001 / ST-VIEW-001。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
