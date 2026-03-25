import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { extractContextNoteReusableEvidence } from '../../human/shared/deliveryContracts'
import { appendContextEvidence } from './helpers'
import { buildContextHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

const mergeReusableEvidence = (state: AiRunState, deliveryMarkdown: string | undefined): string[] => {
  const reusableEvidence = extractContextNoteReusableEvidence(deliveryMarkdown)
  if (reusableEvidence.length === 0) return state.contextEvidence

  return reusableEvidence.reduce(
    (evidences, item) => appendContextEvidence({ ...state, contextEvidence: evidences }, item),
    state.contextEvidence
  )
}

export const createContextEnrichNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: `context-${state.contextRounds + 1}`,
      stage: 'director_context_human',
      userInput: buildContextHumanObjective({
        userInput: state.input,
        contextObjective: String(state.contextObjective || '').trim() || state.input,
        contextEvidence: state.contextEvidence
      }),
      runHumanTask,
      options: {
        deliveryMode: 'context_note',
        internalDelivery: true
      }
    })

    return {
      contextRounds: state.contextRounds + 1,
      contextEvidence: mergeReusableEvidence(state, output.deliveryMarkdown),
      contextObjective: undefined,
      directorStage: 'director_intent'
    }
  }
}
