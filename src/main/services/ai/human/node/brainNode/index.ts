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

    const result = await input.ctx.chatStructured({
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
      temperature: 0.1,
      contextBudgetSnapshot: state.execution.contextBudget
    })
    const inputTokens = result.usage?.inputTokens
    if (inputTokens !== undefined) {
      input.cache.lastBrainInputTokens = inputTokens
      input.cache.lastBrainRoundCount = state.memory.taskRun.rounds.length
      input.cache.postCompactionNeedsFreshBrainUsage = false
      input.cache.lastBrainUsageUnavailable = false
    } else {
      input.cache.lastBrainUsageUnavailable = true
      input.ctx.sendEvent({
        type: 'runtime_issue',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        code: 'llm_usage_unavailable',
        message: '当前模型调用未返回 brain 输入 token usage，暂不基于真实 usage 触发上下文压缩。',
        createdAt: Date.now(),
        stage: 'human_brain'
      })
    }
    const parsedThought = humanThoughtDecisionSchema.parse(result.output)
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
