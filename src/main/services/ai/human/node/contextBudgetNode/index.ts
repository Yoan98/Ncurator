import type { AiRunContext } from '../../../types'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from '../../constants'
import { getCompressibleHistoryRounds } from '../../memory/roundHistory'
import { buildBrainPrompt } from '../../prompts/brain'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimatePromptTokens } from '../../utils/tokenEstimate'

export const createContextBudgetNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const history = await input.ctx.loadHistory()
    const prompt = buildBrainPrompt({
      state,
      ctx: input.ctx,
      sessionMemoryText: history.sessionSummaryText,
      recentConversationText: history.recentTurnsText
    })
    const tokenEstimate = estimatePromptTokens(prompt)
    const contextWindowTokens =
      input.ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    const triggerTokens = Math.floor(contextWindowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO)
    const targetRounds = getCompressibleHistoryRounds(state)
    const shouldCompact = tokenEstimate > triggerTokens && targetRounds.length > 0
    if (tokenEstimate > contextWindowTokens && !shouldCompact) {
      const message = `当前上下文约 ${String(tokenEstimate)} tokens，超过模型窗口 ${String(contextWindowTokens)} tokens，且没有可继续压缩的过程历史。`
      input.ctx.sendEvent({
        type: 'runtime_issue',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        code: 'context_window_exceeded',
        message,
        createdAt: Date.now(),
        stage: 'human_brain'
      })
      throw new Error(message)
    }

    return {
      ...state,
      execution: {
        ...state.execution,
        stage: shouldCompact ? 'memory_compaction' : 'brain',
        contextBudget: {
          tokenEstimate,
          contextWindowTokens,
          triggerTokens
        }
      }
    }
  }
}
