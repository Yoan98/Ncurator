import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  selectScheduledTaskModel,
  selectScheduledTaskWorkspace,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import type { ChatMessage, PartnerListItem, ScheduledTask } from '../../../../src/shared/types'

const CASE_ID = 'scheduled-task-trigger-and-session-refresh'
const FIRST_PROMPT = '请只回复 ok，用于建立当前会话。'
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
          '启用下一分钟触发的定时任务后，向指定伙伴的当前对话追加消息并发送，不新建伙伴。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`
          })

          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName,
            undefined,
            { page, blockerPolicy: 'auto_approve' }
          )

          const partners = await listPartners(page)
          const partner = partners[0]
          if (!partner) throw new Error('failed to locate the partner')
          const messagesAfterFirst = await listPartnerMessages(page, partner.id)

          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('触发验证任务')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formPrompt).fill(TASK_PROMPT)
          await selectScheduledTaskWorkspace(page, setup.workspaceName)
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

          const deadline = Date.now() + 150_000
          let triggeredMessage = false
          while (Date.now() < deadline) {
            const messages = await listPartnerMessages(page, partner.id)
            triggeredMessage = messages.some(
              (message) => message.role === 'user' && message.content.includes(TASK_PROMPT)
            )
            if (triggeredMessage) break
            await page.waitForTimeout(5_000)
          }

          const partnersAfterTrigger = await listPartners(page)
          let triggeredRunCompleted = false
          if (triggeredMessage) {
            const runDeadline = Date.now() + 120_000
            while (Date.now() < runDeadline) {
              const current = (await listPartners(page)).find((item) => item.id === partner.id)
              if (current && !current.isRunning) {
                triggeredRunCompleted = true
                break
              }
              await page.waitForTimeout(3_000)
            }
          }

          return {
            scheduledHhmm,
            samePartner: partnersAfterTrigger.length === 1,
            firstMessageCount: messagesAfterFirst.length,
            triggeredMessage,
            triggeredRunCompleted
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.samePartner && result.triggeredMessage && result.triggeredRunCompleted,
            {
              name: 'scheduled-task-trigger-appends-to-partner',
              message:
                '定时任务到点后应向指定伙伴追加消息并完成运行，不新建伙伴，对齐 ST-RUN-001 / ST-RUN-002。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
