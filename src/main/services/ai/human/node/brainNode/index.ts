import type { AiRunContext } from '../../../types'
import { humanThoughtDecisionSchema } from '../../schema'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyThoughtPatch } from '../../memory/thoughtMemory'
import { buildBrainPrompt } from '../../prompts/brain'
import { assertExternalLearnedSkillIds } from '../../skills'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const history = await input.ctx.loadConversationContext()

    const rawOutput = await input.ctx.chatStructured({
      caller: 'human.brain',
      taskId: state.task.taskId,
      ...buildBrainPrompt({
        state,
        ctx: input.ctx,
        conversationSummaryText: history.conversationSummaryText,
        recentTurnsText: history.recentTurnsText
      }),
      schema: humanThoughtDecisionSchema,
      schemaName: 'human_brain_decision',
      temperature: 0.1
    })
    const parsedThought = humanThoughtDecisionSchema.parse(rawOutput)
    const thoughtMemory = applyThoughtPatch({
      memory: state.memory.thought,
      thought: parsedThought.thought
    })

    return applyBrainDecisionTransition({
      ctx: input.ctx,
      cache: input.cache,
      state,
      thought: parsedThought,
      thoughtMemory
    })
  }
}
