import type { AiRunContext } from '../../../types'
import { lastBrainDecisionSchema } from '../../schema'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { buildBrainPromptContext } from '../../prompts/brain'
import { reduceBrainMemory } from './memoryReducer'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const rawOutput = await input.ctx.chatStructured({
      caller: 'human.brain',
      ...buildBrainPromptContext({
        state,
        ctx: input.ctx
      }),
      schema: lastBrainDecisionSchema,
      schemaName: 'human_brain_decision',
      temperature: 0.1
    })
    const parsedDecision = lastBrainDecisionSchema.parse(rawOutput)
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
