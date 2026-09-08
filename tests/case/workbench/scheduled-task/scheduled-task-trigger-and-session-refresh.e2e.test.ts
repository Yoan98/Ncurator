import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectScheduledTaskModel,
  selectWorkbenchModel,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import type { ChatMessage, PartnerListItem, ScheduledTask } from '../../../../src/shared/types'

const CASE_ID = 'scheduled-task-trigger-and-session-refresh'
const TASK_PROMPT = '定时任务触发验证，请只回复 ok。'

const padTimePart = (value: number): string => String(value).padStart(2, '0')

const nextMinuteHhmm = (): string => {
  const next = new Date(Date.now() + 50_000)
  return `${padTimePart(next.getHours())}:${padTimePart(next.getMinutes())}`
}

const listPartners = async (page: import('playwright').Page): Promise<PartnerListItem[]> =>
  (await page.evaluate(async () => await window.api.partnerList())) as PartnerListItem[]

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

const listPartnerMessages = async (
  page: import('playwright').Page,
  partnerId: string
): Promise<ChatMessage[]> =>
  page.evaluate(async (id) => {
    const opened = await window.api.partnerOpen({ partnerId: id, limit: 50 })
    return opened.messages || []
  }, partnerId)

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
          '启用下一分钟触发的定时任务后，向专属伙伴追加消息并发送，不切换当前查看伙伴。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createPartner: false
          })
          await createPartnerThroughWorkbenchUi(page, '触发查看伙伴')
          await selectWorkbenchModel(page, setup.env.modelName)

          const partnersBefore = await listPartners(page)
          const viewingPartner = partnersBefore[0]
          if (!viewingPartner) throw new Error('failed to locate the viewing partner')

          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('触发验证任务')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPrompt).fill(TASK_PROMPT)
          await selectScheduledTaskModel(page, setup.env.modelName)
          const scheduledHhmm = nextMinuteHhmm()
          await fillScheduledTaskTime(page, scheduledHhmm)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()

          const createdTasks = await listTasks(page)
          const createdTask = createdTasks.find((task) => task.name === '触发验证任务')
          if (!createdTask) throw new Error('failed to create the scheduled task')
          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemTogglePrefix}-${createdTask.id}`
          ).click()

          const partnersAfterConfig = await listPartners(page)
          const boundPartner = partnersAfterConfig.find(
            (partner) => partner.id === createdTask.partnerId
          )
          if (!boundPartner) throw new Error('failed to locate bound partner')

          // 回到原查看伙伴，确认触发不抢焦点。
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${viewingPartner.id}`
          ).click()

          const deadline = Date.now() + 150_000
          let triggeredMessage = false
          while (Date.now() < deadline) {
            const messages = await listPartnerMessages(page, boundPartner.id)
            triggeredMessage = messages.some(
              (message) => message.role === 'user' && message.content.includes(TASK_PROMPT)
            )
            if (triggeredMessage) break
            await page.waitForTimeout(5_000)
          }

          let triggeredRunCompleted = false
          if (triggeredMessage) {
            const runDeadline = Date.now() + 120_000
            while (Date.now() < runDeadline) {
              const current = (await listPartners(page)).find((item) => item.id === boundPartner.id)
              if (current && !current.isRunning) {
                triggeredRunCompleted = true
                break
              }
              await page.waitForTimeout(3_000)
            }
          }

          const selectedStillViewing = await page.evaluate((id) => {
            const active = document.querySelector(
              `[data-testid="workbench-partner-item-${id}"].nc-sidebar-item-active`
            )
            return Boolean(active)
          }, viewingPartner.id)

          return {
            scheduledHhmm,
            boundPartnerCreated: partnersAfterConfig.length === partnersBefore.length + 1,
            sameViewingPartner: selectedStillViewing,
            triggeredMessage,
            triggeredRunCompleted
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.boundPartnerCreated &&
              result.sameViewingPartner &&
              result.triggeredMessage &&
              result.triggeredRunCompleted,
            {
              name: 'scheduled-task-trigger-appends-to-bound-partner',
              message:
                '定时任务到点后应向专属伙伴追加消息并完成运行，且不切换当前查看伙伴，对齐 ST-RUN-001 / ST-RUN-002。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
