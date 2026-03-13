import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { appendContextEvidence } from './helpers'
import { buildContextHumanObjective } from './objectives'

export const createContextEnrichNode = (input: {
  ctx: AiRunContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const contextTaskId = `context-${state.contextRounds + 1}`
    const objective = buildContextHumanObjective({
      userInput: state.input,
      contextObjective: String(state.contextObjective || '').trim() || state.input,
      contextEvidence: state.contextEvidence
    })

    const output = await runHumanTask({
      taskId: contextTaskId,
      objective
    }, {
      deliveryKind: 'context',
      internalDelivery: true
    })

    return {
      contextRounds: state.contextRounds + 1,
      contextEvidence: appendContextEvidence(
        {
          ...state,
          contextEvidence: appendContextEvidence(state, output.summary)
        },
        output.deliveryMarkdown
      ),
      contextObjective: undefined,
      mainStage: 'main_intent'
    }
  }
}
