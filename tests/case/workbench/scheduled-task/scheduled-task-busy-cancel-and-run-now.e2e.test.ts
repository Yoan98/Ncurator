import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectScheduledTaskPartner,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  setWorkbenchInput,
  setupWorkbenchWithTempWorkspace,
  waitForScheduledTaskDrawerClosed,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-busy-cancel-and-run-now'
const TASK_NAMES = ['关闭忙碌提示', '确认立即执行']
const TASK_PROMPT = '定时任务恢复验证，请只回复已收到。'

const waitForState = async (
  condition: () => Promise<boolean>,
  message: string,
  timeoutMs = 30_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
}

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        description: '真实伙伴等待用户时跳过到点任务，胶囊可关闭，立即执行遵守占用限制。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            workspaceName: '定时任务忙碌伙伴'
          })
          const partner = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === setup.workspaceName
          )
          if (!partner) throw new Error('scheduled task partner missing')
          await createPartnerThroughWorkbenchUi(page, '切换查看提示的伙伴')
          const otherPartner = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === '切换查看提示的伙伴'
          )
          if (!otherPartner) throw new Error('navigation partner missing')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).click()
          await selectWorkbenchModel(page, setup.env.modelName)
          await sendWorkbenchMessage(
            page,
            '请先通过界面向我提问，询问我希望报告采用哪种语言，给出中文和英文两个选项。等待我的选择后再继续，不要替我选择。'
          )
          await waitForWorkbenchAiEvent(runtime, {
            name: 'scheduled-task-partner-waiting-human',
            timeoutMs: 120_000,
            matches: (event) =>
              event.type === 'human_interaction_required' && event.interaction.kind === 'question'
          })
          await page.getByTestId(workbenchSelectors.humanQuestionCard).waitFor({ state: 'visible' })

          await openScheduledTasksView(page)
          const next = new Date(Date.now() + 150_000)
          const hhmm = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
          for (const name of TASK_NAMES) {
            await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
            await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(name)
            await setWorkbenchInput(page, TASK_PROMPT, scheduledTaskSelectors.formDescriptionInput)
            await selectScheduledTaskPartner(page, partner.id)
            await fillScheduledTaskTime(page, hhmm)
            await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
            await waitForScheduledTaskDrawerClosed(page)
          }
          const before = await page.evaluate(() => window.api.scheduledTaskList())
          if (
            before.length !== 2 ||
            before.some((task) => !task.nextRunAt || task.nextRunAt <= Date.now())
          ) {
            throw new Error('both tasks must be saved before their actual due time')
          }
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).click()
          await waitForState(
            async () => {
              const tasks = await page.evaluate(() => window.api.scheduledTaskList())
              return before.every((original) =>
                tasks.some(
                  (task) =>
                    task.id === original.id &&
                    task.busyCancelNoticeAt !== null &&
                    task.nextRunAt !== null &&
                    task.nextRunAt > original.nextRunAt!
                )
              )
            },
            '真实到点后未收到忙碌取消和下一周期推进',
            210_000
          )
          const afterDue = await page.evaluate(() => window.api.scheduledTaskList())
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${otherPartner.id}`
          ).click()
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).click()
          await page.getByTestId(workbenchSelectors.humanQuestionCard).waitFor({ state: 'visible' })
          const messages = await page.evaluate(
            async (partnerId) =>
              (await window.api.partnerOpen({ partnerId, limit: 50 })).messages || [],
            partner.id
          )
          const capsule = getWorkbenchLocator(page, scheduledTaskSelectors.busyCancelCapsule)
          const capsuleVisibleWhileWaiting = await capsule.isVisible()
          await runtime.captureScreenshot({
            name: 'busy-notice-while-waiting',
            message: '到点忙碌取消后重新进入绑定伙伴，记录等待用户时的胶囊可见性。'
          })

          // The task list remains accessible while the partner waits for a human.
          await openScheduledTasksView(page)
          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemRunNowPrefix}-${before[0].id}`
          ).click()
          const confirm = page.locator('.ant-modal-confirm')
          await confirm.waitFor({ state: 'visible' })
          await confirm.locator('.ant-btn-primary').click()
          const busyError = page
            .getByText('请等待当前任务结束，或先停止后再执行', { exact: true })
            .first()
          await busyError.waitFor({ state: 'visible' })
          const busyRejected = await busyError.isVisible()
          const messagesAfterRejected = await page.evaluate(
            async (partnerId) =>
              (await window.api.partnerOpen({ partnerId, limit: 50 })).messages || [],
            partner.id
          )
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).click()
          await page.getByTestId('workbench-human-question-cancel').click()
          await page.getByTestId(workbenchSelectors.humanQuestionCard).waitFor({ state: 'hidden' })
          await waitForState(
            async () =>
              (await page.evaluate(() => window.api.partnerList())).find(
                (item) => item.id === partner.id
              )?.isRunning === false,
            '停止后伙伴仍然忙碌'
          )

          await capsule.waitFor({ state: 'visible' })
          const firstCapsule = (await capsule.textContent()) || ''
          await getWorkbenchLocator(page, scheduledTaskSelectors.busyCancelDismiss).click()
          await waitForState(
            async () =>
              (await page.evaluate(() => window.api.scheduledTaskList())).filter(
                (task) => task.busyCancelNoticeAt !== null
              ).length === 1,
            '关闭胶囊后忙碌提示未清除'
          )
          const remaining = (await page.evaluate(() => window.api.scheduledTaskList())).find(
            (task) => task.busyCancelNoticeAt !== null
          )
          if (!remaining) throw new Error('second busy notice missing')
          // Dismissing a capsule clears that visible notice; re-enter to view another task.
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${otherPartner.id}`
          ).click()
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partner.id}`
          ).click()
          await page.waitForFunction(
            ({ id, name }) =>
              document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes(name),
            { id: scheduledTaskSelectors.busyCancelCapsule, name: remaining.name }
          )
          const afterDismiss = await page.evaluate(
            async (partnerId) =>
              (await window.api.partnerOpen({ partnerId, limit: 50 })).messages || [],
            partner.id
          )
          await capsule.click()
          await confirm.waitFor({ state: 'visible' })
          const confirmVisible = await confirm.isVisible()
          await confirm.locator('.ant-btn-primary').click()
          await waitForState(async () => {
            const messages = await page.evaluate(
              async (partnerId) =>
                (await window.api.partnerOpen({ partnerId, limit: 50 })).messages || [],
              partner.id
            )
            return messages.some(
              (message) => message.role === 'user' && message.content.includes(TASK_PROMPT)
            )
          }, '确认立即执行后未追加任务消息')
          await waitForState(
            async () =>
              (await page.evaluate(() => window.api.partnerList())).find(
                (item) => item.id === partner.id
              )?.isRunning === false,
            '立即执行后伙伴未结束运行',
            120_000
          )
          const finalMessages = await page.evaluate(
            async (partnerId) =>
              (await window.api.partnerOpen({ partnerId, limit: 50 })).messages || [],
            partner.id
          )
          const finalTasks = await page.evaluate(() => window.api.scheduledTaskList())
          const countTaskMessages = (items: typeof messages) =>
            items.filter(
              (message) => message.role === 'user' && message.content.includes(TASK_PROMPT)
            ).length
          return {
            before: before.map(({ id, name, nextRunAt, busyCancelNoticeAt }) => ({
              id,
              name,
              nextRunAt,
              busyCancelNoticeAt
            })),
            afterDue: afterDue.map(({ id, name, nextRunAt, busyCancelNoticeAt }) => ({
              id,
              name,
              nextRunAt,
              busyCancelNoticeAt
            })),
            finalTasks: finalTasks.map(({ id, name, nextRunAt, busyCancelNoticeAt }) => ({
              id,
              name,
              nextRunAt,
              busyCancelNoticeAt
            })),
            capsuleVisibleWhileWaiting,
            firstCapsule,
            busyRejected,
            confirmVisible,
            messagesAtDue: countTaskMessages(messages),
            messagesAfterRejected: countTaskMessages(messagesAfterRejected),
            messagesAfterDismiss: countTaskMessages(afterDismiss),
            finalTaskMessages: countTaskMessages(finalMessages)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.messagesAtDue === 0 &&
              result.afterDue.every(
                (task) =>
                  task.busyCancelNoticeAt !== null &&
                  task.nextRunAt! > result.before.find((item) => item.id === task.id)!.nextRunAt!
              ),
            {
              name: 'busy-due-advances-without-submission',
              message: '忙碌到点不提交、推进下一周期，对齐 ST-RUN-001-AC3。',
              data: result
            }
          )
          await runtime.assertThat(
            result.busyRejected &&
              result.messagesAfterRejected === 0 &&
              result.messagesAfterDismiss === 0 &&
              result.confirmVisible &&
              result.finalTaskMessages === 1 &&
              result.finalTasks.every(
                (task) =>
                  task.busyCancelNoticeAt === null &&
                  task.nextRunAt === result.afterDue.find((item) => item.id === task.id)?.nextRunAt
              ),
            {
              name: 'busy-notice-dismiss-and-manual-run',
              message:
                '关闭不执行；仍忙碌时拒绝；空闲后确认只执行一次且保留周期，对齐 ST-RUN-004-AC2/AC3、ST-RUN-005-AC2/AC3。',
              data: result
            }
          )
          await runtime.assertThat(
            result.capsuleVisibleWhileWaiting &&
              TASK_NAMES.some((name) => result.firstCapsule.includes(name)),
            {
              name: 'busy-notice-visible-on-bound-partner',
              message: '忙碌取消后进入绑定伙伴可见包含任务名的胶囊，对齐 ST-RUN-005-AC1。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
