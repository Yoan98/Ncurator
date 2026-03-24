import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildSynthesisHumanPatch } from './helpers'
import { buildSynthesisHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

const SYNTHESIS_TASK_ID = 'synthesis-human'

export const createSynthesisHumanNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: SYNTHESIS_TASK_ID,
      stage: 'director_synthesis_human',
      userInput: buildSynthesisHumanObjective({
        userInput: state.input,
        selectedScopeSummary: ctx.selectedScopeSummary,
        contextEvidence: state.contextEvidence,
        plan: state.plan
      }),
      runHumanTask,
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      }
    })

    return buildSynthesisHumanPatch({
      state,
      output
    })
  }
}
