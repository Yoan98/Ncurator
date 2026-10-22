import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'
import type { AiRunEvent } from '../../../../../src/shared/types'

const CASE_ID = 'session-skill-memory-persistence'
const FIRST_PROMPT =
  '请先加载读取 Word 文档的工具组，然后读取当前工作区的 sample-edit.docx，最后简要说明文档内容。'
const SECOND_PROMPT =
  '继续处理刚才的 Word 文档。不要再次加载工具组，直接读取 sample-edit.docx，并说明当前是否还能使用 Word 读取能力。'

const getHumanSteps = (events: AiRunEvent[]) =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: 'human_step' }> => event.type === 'human_step'
  )

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['persistence'],
        description:
          '真实 Workbench 同一会话的多轮 AI run 应共享已加载的 Word 工具组，后续 run 不需要重新 toolset_loading。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })

          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, FIRST_PROMPT)
          const firstEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, firstEvidence, 0.8)

          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, SECOND_PROMPT)
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.8)

          return {
            firstHumanSteps: getHumanSteps(firstEvidence.events),
            secondHumanSteps: getHumanSteps(secondEvidence.events),
            firstFinalAnswer: firstEvidence.finalAnswerText,
            secondFinalAnswer: secondEvidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          const firstToolsetLoadingSteps = result.firstHumanSteps.filter(
            (step) => step.action === 'load_toolset'
          )
          const secondToolsetLoadingSteps = result.secondHumanSteps.filter(
            (step) => step.action === 'load_toolset'
          )
          const secondBrainSteps = result.secondHumanSteps.filter(
            (step) => step.action === 'brain_decision'
          )

          await runtime.assertThat(
            firstToolsetLoadingSteps.some((step) => step.toolsetId === 'docx-read') &&
              secondToolsetLoadingSteps.length === 0 &&
              secondBrainSteps.some(
                (step) =>
                  step.loadedToolsetIds.includes('docx-read') &&
                  step.availableToolNames.includes('docx_read_outline')
              ) &&
              result.firstFinalAnswer.trim().length > 0 &&
              result.secondFinalAnswer.trim().length > 0,
            {
              name: 'workbench-session-toolset-memory-persists-across-runs',
              message:
                'Workbench 同一会话第二轮应直接恢复第一轮加载的 docx-read 工具组，不应重新执行 toolset_loading。',
              data: {
                firstToolsetLoadingSteps,
                secondToolsetLoadingSteps,
                secondBrainSteps,
                firstFinalAnswer: result.firstFinalAnswer,
                secondFinalAnswer: result.secondFinalAnswer
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 2
  )
})
