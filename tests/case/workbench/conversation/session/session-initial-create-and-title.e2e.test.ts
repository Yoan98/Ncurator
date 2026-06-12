import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  sendWorkbenchMessage,
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
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'conversation',
      groups: ['session'],
      description: '真实 UI 首次进入 Workbench 后创建新会话，首条消息更新标题，第二条消息不再自动改标题。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const initialSessionsText = await readSessionListText(page)
          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          const firstEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, firstEvidence, 0.8)
          const afterFirstSessionsText = await readSessionListText(page)

          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, SECOND_PROMPT)
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.8)
          const afterSecondSessionsText = await readSessionListText(page)

          return {
            initialSessionsText,
            afterFirstSessionsText,
            afterSecondSessionsText,
            firstTitlePrefix: FIRST_PROMPT.slice(0, 20),
            secondTitlePrefix: SECOND_PROMPT.slice(0, 20),
            firstFinalAnswer: firstEvidence.finalAnswerText,
            secondFinalAnswer: secondEvidence.finalAnswerText
          }
        } finally {
          await setup.workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.initialSessionsText.includes('新对话') &&
            result.afterFirstSessionsText.includes(result.firstTitlePrefix) &&
            result.afterSecondSessionsText.includes(result.firstTitlePrefix) &&
            !result.afterSecondSessionsText.includes(result.secondTitlePrefix) &&
            result.firstFinalAnswer.trim().length > 0 &&
            result.secondFinalAnswer.trim().length > 0,
          {
            name: 'workbench-session-title-lifecycle',
            message:
              'Workbench 首次进入应有“新对话”；第一条真实消息后标题应更新为首条消息摘要，第二条真实消息不应再次自动改写标题，对齐 WB-SESSION-001-AC1、WB-SESSION-001-AC2、WB-SESSION-003-AC1、WB-SESSION-003-AC2。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
