import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { buildDirectHumanObjective } from './objectives'

const DIRECT_TASK_ID = 'direct-human'

export const createDirectHumanExecNode = (input: {
  ctx: AiRunContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    ctx.sendEvent({
      type: 'task_started',
      runId: state.runId,
      taskId: DIRECT_TASK_ID,
      stage: 'main_direct_human_exec'
    })

    const output = await runHumanTask(
      {
        taskId: DIRECT_TASK_ID,
        userInput: buildDirectHumanObjective({
          userInput: state.input,
          contextEvidence: state.contextEvidence
        })
      },
      {
        deliveryMode: 'user_answer',
        streamAnswer: true
      }
    )

    if (output.status === 'blocked') {
      ctx.sendEvent({
        type: 'task_blocked',
        runId: state.runId,
        taskId: DIRECT_TASK_ID,
        summary: output.summary,
        stage: 'main_direct_human_exec'
      })
    } else {
      ctx.sendEvent({
        type: 'task_completed',
        runId: state.runId,
        taskId: DIRECT_TASK_ID,
        stage: 'main_direct_human_exec'
      })
    }

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      mainStage: 'main_complete'
    }
  }
}
