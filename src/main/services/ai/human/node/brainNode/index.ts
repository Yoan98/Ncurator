import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { buildBrainPromptContext } from './promptContext'
import { brainDecisionOutputSchema, parseBrainDecisionOutput } from './decisionContract'
import { reduceBrainMemory } from './memoryReducer'
import type { AiRunContextWithHumanOverrides } from '../types'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  const ctxWithOverride = input.ctx as AiRunContextWithHumanOverrides

  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const overriddenDecision = ctxWithOverride.resolveBrainDecisionOverride?.()
    const rawOutput = overriddenDecision
      ? overriddenDecision
      : await input.ctx.chatStructured({
          caller: 'human.brain',
          ...buildBrainPromptContext(state),
          schema: brainDecisionOutputSchema,
          schemaName: 'human_brain_decision',
          temperature: 0.1
        })
    const parsedDecision = parseBrainDecisionOutput(rawOutput)
    const reducedMemory = reduceBrainMemory({
      inside: state.brainMemory.inside,
      memoryOps: parsedDecision.memoryOps
    })

    return applyBrainDecisionTransition({
      ctx: input.ctx,
      cache: input.cache,
      state,
      decision: parsedDecision,
      reducedInside: reducedMemory.inside,
      watchHint: reducedMemory.watchHint
    })
  }
}
