import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildDirectHumanPatch } from './helpers'
import { buildDirectHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

const DIRECT_TASK_ID = 'direct-human'

export const createDirectHumanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: DIRECT_TASK_ID,
      stage: 'director_direct_human_exec',
      userInput: buildDirectHumanObjective({
        userInput: state.input,
        contextEvidence: state.contextEvidence
      }),
      runHumanTask,
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      }
    })

    return buildDirectHumanPatch(output)
  }
}
