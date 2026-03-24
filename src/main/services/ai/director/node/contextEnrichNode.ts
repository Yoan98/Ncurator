import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildContextEnrichPatch } from './helpers'
import { buildContextHumanObjective } from './objectives'
import { runDirectorHumanSubtask } from './humanDispatch'

export const createContextEnrichNode = (input: {
  ctx: DirectorNodeContext
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

    return buildContextEnrichPatch({
      state,
      output
    })
  }
}
