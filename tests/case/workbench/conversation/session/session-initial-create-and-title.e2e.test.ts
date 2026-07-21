import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  selectWorkbenchWorkspace,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors,
  recordWorkbenchAiEvidence
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'session-initial-create-and-title'
const FIRST_PROMPT =
  '请基于当前工作区的 human-input.txt，用一句话告诉我里面用于 workspace read validation 的事实。'
const SECOND_PROMPT = '再用一句话说明这条事实为什么适合做 Workbench 读文件验证。'

const readSessionListText = async (page: import('playwright').Page): Promise<string> =>
  ((await getWorkbenchLocator(page, workbenchSelectors.sessionsList).textContent()) || '').trim()

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session'],
        description:
          '真实 UI 首次进入 Workbench 后不自动创建会话，用户手动创建后首条消息更新标题，第二条消息不再自动改标题。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setupStartedAt = Date.now()
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            createSession: false
          })
          const initialSessionsText = await readSessionListText(page)
          const autoCreatedSessionCount = await page.evaluate(
            async (startedAt) =>
              (await window.api.chatSessionList()).filter(
                (session) => session.created_at >= startedAt
              ).length,
            setupStartedAt
          )
          const manualCreateStartedAt = Date.now()
          await page.getByRole('button', { name: `在 ${setup.workspaceName} 中新建对话` }).click()
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          const afterManualCreateSessionsText = await readSessionListText(page)
          const manuallyCreatedSessionCount = await page.evaluate(
            async (startedAt) =>
              (await window.api.chatSessionList()).filter(
                (session) => session.created_at >= startedAt
              ).length,
            manualCreateStartedAt
          )
          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          const firstEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, firstEvidence, 0.8)
          const afterFirstSessionsText = await readSessionListText(page)
          const afterFirstCreatedSessionCount = await page.evaluate(
            async (startedAt) =>
              (await window.api.chatSessionList()).filter(
                (session) => session.created_at >= startedAt
              ).length,
            manualCreateStartedAt
          )

          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, SECOND_PROMPT)
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.8)
          const afterSecondSessionsText = await readSessionListText(page)

          return {
            initialSessionsText,
            afterManualCreateSessionsText,
            autoCreatedSessionCount,
            manuallyCreatedSessionCount,
            afterFirstCreatedSessionCount,
            afterFirstSessionsText,
            afterSecondSessionsText,
            firstTitlePrefix: FIRST_PROMPT.slice(0, 20),
            secondTitlePrefix: SECOND_PROMPT.slice(0, 20),
            firstFinalAnswer: firstEvidence.finalAnswerText,
            secondFinalAnswer: secondEvidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.autoCreatedSessionCount === 0 &&
              result.manuallyCreatedSessionCount === 0 &&
              result.afterFirstCreatedSessionCount === 1 &&
              result.afterFirstSessionsText.includes(result.firstTitlePrefix) &&
              result.afterSecondSessionsText.includes(result.firstTitlePrefix) &&
              !result.afterSecondSessionsText.includes(result.secondTitlePrefix) &&
              result.firstFinalAnswer.trim().length > 0 &&
              result.secondFinalAnswer.trim().length > 0,
            {
              name: 'workbench-session-title-lifecycle',
              message:
                'Workbench 首次进入、点击新对话和选择工作空间都不应落库；第一条真实消息发送后才应创建会话并更新标题，第二条真实消息不应再次自动改写标题。',
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
