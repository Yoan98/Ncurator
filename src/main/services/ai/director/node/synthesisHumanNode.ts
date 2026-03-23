import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { mergeArtifactRefs } from '../../utils/artifacts'
import { buildSynthesisHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

const SYNTHESIS_TASK_ID = 'synthesis-human'

export const createSynthesisHumanNode = (input: {
  ctx: AiRunContext
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

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      finalArtifacts: mergeArtifactRefs(
        ...state.plan.map((task) => task.artifacts),
        output.artifacts
      ),
      directorStage: 'director_complete'
    }
  }
}
