import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'timeline-day-jump'
const PROMPT = '请只回复 ok，用于时间轴跳转测试。'

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['timeline'],
        description: '有消息后时间轴默认展示今/昨/前天，点击今天跳到当天最早一条消息。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.6)

          const timeline = getWorkbenchLocator(page, workbenchSelectors.timeline)
          await timeline.waitFor({ state: 'visible' })
          const todayStart = startOfLocalDay(Date.now())
          const labels = ((await timeline.textContent()) || '').replace(/\s+/g, '')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-${todayStart}`
          ).click()
          const userMessage = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).first()
          await userMessage.waitFor({ state: 'visible' })
          const userMessageInView = await userMessage.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight + 80
          })

          return {
            labels,
            userMessageInView,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.labels.includes('今天') &&
              result.labels.includes('昨天') &&
              result.labels.includes('前天') &&
              result.userMessageInView &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-timeline-day-jump',
              message: '时间轴应默认展示今/昨/前天，点击今天后应落到当天最早一条消息。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
