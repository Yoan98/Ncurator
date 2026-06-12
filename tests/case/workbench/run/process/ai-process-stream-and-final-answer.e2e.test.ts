import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantFinalAnswerText,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'ai-process-stream-and-final-answer'
const PROMPT =
  '请只依据当前工作区里的工作目录资料，整理对外口径确认结论：风险状态、主负责人、Bob 的后续动作。回答必须包含 Alice 和 Bob。'

describe('workbench run e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['process'],
      description: '真实 AI 总结 workspace 唯一事实，验证过程流、最终回答和不暴露原始 chain-of-thought。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const processLocator = await waitForLatestAssistantProcess(page)
          const processTextDuringRun = ((await processLocator.textContent()) || '').trim()
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          const finalAnswerText = await waitForLatestAssistantFinalAnswerText(page)
          recordWorkbenchAiEvidence(runtime, evidence, 0.85)
          const processItemCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessItemPrefix
          ).count()

          return {
            processTextDuringRun,
            processItemCount,
            finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type)
          }
        } finally {
          await setup.workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.processTextDuringRun.length > 0 &&
            result.processItemCount > 0 &&
            result.eventTypes.includes('answer_completed') &&
            result.eventTypes.includes('run_completed') &&
            /Alice|合规负责人/u.test(result.finalAnswerText) &&
            /Bob|财务接口人/u.test(result.finalAnswerText) &&
            !/chain[- ]?of[- ]?thought|思维链|<thinking|<\/thinking>/iu.test(
              result.finalAnswerText
            ),
          {
            name: 'workbench-ai-process-final-answer-real',
            message:
              '真实 AI run 应展示过程流并产出围绕工作区事实的最终 markdown，最终回答不应裸露 chain-of-thought，对齐 WB-COMPOSER-003、WB-CORE-005、WB-CORE-006。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
