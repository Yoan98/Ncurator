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
        userInput: buildSynthesisHumanObjective({
          userInput: state.input,
          selectedScopeSummary: ctx.selectedScopeSummary,
          contextEvidence: state.contextEvidence,
          plan: state.plan
        })
      },
      {
        streamAnswer: true
      }
    )

    if (output.status === 'blocked') {
      ctx.sendEvent({
        type: 'task_blocked',
        runId: state.runId,
        taskId: SYNTHESIS_TASK_ID,
        summary: output.summary,
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

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      mainStage: 'main_complete'
    }
  }
}
