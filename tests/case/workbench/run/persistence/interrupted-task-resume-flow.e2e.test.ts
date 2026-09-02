import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantFinalAnswerText,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'interrupted-task-resume-flow'
const INITIAL_PROMPT = '请计算 17 加 25，最终回答只需要给出计算结果。'
const RESUME_PROMPT = '继续完成原任务，并在最终回答中明确写出“恢复任务成功”和计算结果。'
const RUNTIME_LIMIT_MESSAGE = '已达到运行上限，可继续对话推进'

const waitForRunEvent = async <TEvent extends AiRunEvent>(input: {
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
  name: string
  runId?: string
  matches: (event: AiRunEvent) => event is TEvent
}): Promise<TEvent> => {
  const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(input.runtime)
    const matched = events.find(
      (event): event is TEvent =>
        (!input.runId || ('runId' in event && event.runId === input.runId)) && input.matches(event)
    )
    if (matched) return matched
    if (Date.now() >= deadline) throw new Error(`AI event ${input.name} timed out`)
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['persistence'],
        description: '真实模型触发一次 Graph 运行上限后，在同一会话继续并恢复原任务。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        extraEnv: {
          NCURATOR_E2E_HUMAN_GRAPH_RECURSION_LIMIT_ONCE: '2'
        },
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })

          await sendWorkbenchMessage(page, INITIAL_PROMPT)
          const firstRunStarted = await waitForRunEvent({
            runtime,
            name: 'initial_run_started',
            matches: (event): event is Extract<AiRunEvent, { type: 'run_started' }> =>
              event.type === 'run_started' && event.input === INITIAL_PROMPT
          })
          const runtimeLimitFailure = await waitForRunEvent({
            runtime,
            name: 'runtime_limit_failure',
            runId: firstRunStarted.runId,
            matches: (event): event is Extract<AiRunEvent, { type: 'run_failed' }> =>
              event.type === 'run_failed' && event.code === 'runtime_limit'
          })
          const firstRunLlmCompleted = await waitForRunEvent({
            runtime,
            name: 'initial_real_llm_completed',
            runId: firstRunStarted.runId,
            matches: (event): event is Extract<AiRunEvent, { type: 'activity' }> =>
              event.type === 'activity' &&
              event.actionType === 'llm_tool_calls' &&
              event.status === 'completed'
          })
          await page
            .getByText(RUNTIME_LIMIT_MESSAGE, { exact: true })
            .first()
            .waitFor({ state: 'visible' })

          await sendWorkbenchMessage(page, RESUME_PROMPT)
          const resumedRunStarted = await waitForRunEvent({
            runtime,
            name: 'resumed_run_started',
            matches: (event): event is Extract<AiRunEvent, { type: 'run_started' }> =>
              event.type === 'run_started' && event.input === RESUME_PROMPT
          })
          await waitForWorkbenchAiRunCompletion(
            runtime,
            resumedRunStarted.createdAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          const finalAnswerText = await waitForLatestAssistantFinalAnswerText(page)

          return {
            runtimeLimitFailure,
            firstRunLlmCompleted,
            finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.runtimeLimitFailure.message === RUNTIME_LIMIT_MESSAGE &&
              result.runtimeLimitFailure.code === 'runtime_limit' &&
              result.firstRunLlmCompleted.status === 'completed' &&
              result.finalAnswerText.includes('恢复任务成功') &&
              result.finalAnswerText.includes('42'),
            {
              name: 'workbench-runtime-limit-resume-real',
              message:
                '真实模型达到临时 Graph 上限后应显示可继续提示、保存快照，并在同一会话恢复完成。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 2
  )
})
