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
import type { ChatSessionListItem, ScheduledTask } from '../../../src/shared/types'

const CASE_ID = 'scheduled-task-trigger-and-session-refresh'
const FIRST_PROMPT = '请只回复 ok，用于建立当前会话。'
const TASK_PROMPT = '定时任务触发验证，请只回复 ok。'

const padTimePart = (value: number): string => String(value).padStart(2, '0')

const nextMinuteHhmm = (): string => {
  const next = new Date(Date.now() + 120_000)
  return `${padTimePart(next.getHours())}:${padTimePart(next.getMinutes())}`
}

const listSessions = async (page: import('playwright').Page): Promise<ChatSessionListItem[]> =>
  (await page.evaluate(async () => await window.api.chatSessionList())) as ChatSessionListItem[]

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

const readActiveSessionId = async (
  page: import('playwright').Page
): Promise<string | null> =>
  page.evaluate((prefix) => {
    const element = document.querySelector(`[data-testid^="${prefix}"].nc-sidebar-item-active`)
    const testId = element?.getAttribute('data-testid') || ''
    return testId.replace(`${prefix}-`, '')
  }, workbenchSelectors.sessionItemPrefix)

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
          '启用下一分钟触发的定时任务后，在配置工作空间下创建新会话并发送任务消息，会话列表自动刷新且不切换当前会话。',
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
            createSession: false
          })

          await page.getByRole('button', { name: `在 ${setup.workspaceName} 中新建对话` }).click()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          await waitForWorkbenchAiRunCompletion(runtime, Date.now(), setup.env.modelName)

          const sessionsAfterFirst = await listSessions(page)
          const firstSession = sessionsAfterFirst.find(
            (session) => session.title === FIRST_PROMPT.slice(0, 20)
          )
          if (!firstSession) throw new Error('failed to locate the first session')

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
          const taskCreatedAt = Date.now()
          await getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.itemTogglePrefix}-${createdTask.id}`
          ).click()

          const triggeredStartedAt = Date.now()
          const deadline = triggeredStartedAt + 240_000
          let triggeredSession: ChatSessionListItem | null = null
          while (Date.now() < deadline) {
            const sessions = await listSessions(page)
            triggeredSession =
              sessions.find(
                (session) =>
                  session.id !== firstSession.id &&
                  session.created_at >= taskCreatedAt &&
                  session.title === TASK_PROMPT.slice(0, 20)
              ) || null
            if (triggeredSession) break
            await page.waitForTimeout(5_000)
          }

          const activeSessionId = await readActiveSessionId(page)

          let triggeredRunCompleted = false
          if (triggeredSession) {
            const runDeadline = Date.now() + 180_000
            while (Date.now() < runDeadline) {
              const sessions = await listSessions(page)
              const current = sessions.find((session) => session.id === triggeredSession?.id)
              if (current && !current.isRunning) {
                triggeredRunCompleted = true
                break
              }
              await page.waitForTimeout(3_000)
            }
          }

          return {
            scheduledHhmm,
            triggeredSessionCreated: Boolean(triggeredSession),
            triggeredTitlePrefix: TASK_PROMPT.slice(0, 20),
            triggeredRunCompleted,
            activeSessionUnchanged: activeSessionId === firstSession.id
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.triggeredSessionCreated &&
              result.triggeredRunCompleted &&
              result.activeSessionUnchanged,
            {
              name: 'scheduled-task-trigger-and-session-refresh',
              message:
                '定时任务到点后应在配置工作空间下创建新会话并发送消息，运行完成后会话列表自动刷新且不切换当前会话，对齐 ST-RUN-001 / ST-RUN-002。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
