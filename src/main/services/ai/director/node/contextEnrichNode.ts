import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { appendContextEvidence, extractReusableContextEvidence } from './helpers'
import { buildContextHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

export const createContextEnrichNode = (input: {
  ctx: AiRunContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const contextTaskId = `context-${state.contextRounds + 1}`
    const contextUserInput = buildContextHumanObjective({
      userInput: state.input,
      contextObjective: String(state.contextObjective || '').trim() || state.input,
      contextEvidence: state.contextEvidence
    })

    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: contextTaskId,
      stage: 'director_context_human',
      userInput: contextUserInput,
      runHumanTask,
      options: {
        deliveryMode: 'context_note',
        internalDelivery: true
      }
    })

    if (output.status === 'blocked') {
      return {
        contextRounds: state.contextRounds + 1,
        contextObjective: undefined,
        directorStage: 'director_intent'
      }
    }

    const reusableEvidence = extractReusableContextEvidence(output.deliveryMarkdown)
    const nextContextEvidence =
      reusableEvidence.length > 0
        ? reusableEvidence.reduce(
            (evidences, item) => appendContextEvidence({ ...state, contextEvidence: evidences }, item),
            state.contextEvidence
          )
        : appendContextEvidence(state, output.summary)

    return {
      contextRounds: state.contextRounds + 1,
      contextEvidence: nextContextEvidence,
      contextObjective: undefined,
      directorStage: 'director_intent'
    }
  }
}
