import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { buildSynthesisHumanObjective } from './objectives'

const SYNTHESIS_TASK_ID = 'synthesis-human'

export const createSynthesisHumanNode = (input: {
  ctx: AiRunContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    ctx.sendEvent({
      type: 'task_started',
      runId: state.runId,
      taskId: SYNTHESIS_TASK_ID,
      stage: 'main_synthesis_human'
    })

    const output = await runHumanTask(
      {
        taskId: SYNTHESIS_TASK_ID,
        objective: buildSynthesisHumanObjective({
          userInput: state.input,
          selectedScopeSummary: ctx.selectedScopeSummary,
          contextEvidence: state.contextEvidence,
          plan: state.plan
        })
      },
      {
        deliveryKind: 'final',
        streamAnswer: true
      }
    )

    if (output.status === 'blocked') {
      ctx.sendEvent({
        type: 'task_failed',
        runId: state.runId,
        taskId: SYNTHESIS_TASK_ID,
        error: output.summary,
        stage: 'main_synthesis_human'
      })
    } else {
      ctx.sendEvent({
        type: 'task_completed',
        runId: state.runId,
        taskId: SYNTHESIS_TASK_ID,
        stage: 'main_synthesis_human'
      })
    }

    ctx.sendEvent({
      type: 'task_result',
      runId: state.runId,
      taskId: SYNTHESIS_TASK_ID,
      code: output.resultCode,
      message: output.summary,
      data: output.resultData,
      stage: 'main_synthesis_human'
    })

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      finalDeliveryTaskId: SYNTHESIS_TASK_ID,
      localSourceStatus: output.localSourceStatus,
      localSourceSummary: output.localSourceSummary,
      error: output.status === 'blocked' ? output.summary : state.error,
      mainStage: 'main_complete'
    }
  }
}
