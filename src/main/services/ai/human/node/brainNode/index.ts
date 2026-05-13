import type { AiRunContext } from '../../../types'
import { humanThoughtDecisionSchema } from '../../schema'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyStableMemoryPatch } from '../../memory/stableMemory'
import { buildBrainPrompt } from '../../prompts/brain'
import { renderSessionMemoryForBrain } from '../../shared/sessionMemoryRenderers'
import { assertExternalLearnedSkillIds } from '../../skills'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const sessionMemory = await input.ctx.loadSessionMemory()

    const rawOutput = await input.ctx.chatStructured({
      caller: 'human.brain',
      taskId: state.task.taskId,
      ...buildBrainPrompt({
        state,
        ctx: input.ctx,
        sessionMemoryText: renderSessionMemoryForBrain(sessionMemory)
      }),
      schema: humanThoughtDecisionSchema,
      schemaName: 'human_brain_decision',
      temperature: 0.1
    })
    const parsedThought = humanThoughtDecisionSchema.parse(rawOutput)
    const stableMemory = applyStableMemoryPatch({
      stable: state.memory.stable,
      patch: parsedThought.updatedStableMemory
    })

    return applyBrainDecisionTransition({
      ctx: input.ctx,
      cache: input.cache,
      state,
      thought: parsedThought,
      stableMemory
    })
  }
}
