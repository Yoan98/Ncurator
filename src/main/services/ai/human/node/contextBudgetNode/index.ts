import { randomUUID } from 'node:crypto'
import type { BrainContextBudgetSnapshot } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import {
  CONTEXT_COMPACTION_MIN_SOURCE_RATIO,
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from '../../constants'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { splitMessagesByLastAi } from '../utils/messageTail'
import { estimateMessagesForContext } from '../../memory/multimodal'
import { isCurrentBrainUserMessage } from '../utils/messageTail'
import { LlmInputTooLongError } from '../../../errors'

const buildBudgetSnapshot = (input: {
  cache: HumanRuntimeCache
  contextWindowTokens: number
  compactionTriggerTokens: number
  hasCompressibleHistory: boolean
  currentMessageTokenEstimate: number
}): BrainContextBudgetSnapshot => {
  if (input.cache.postCompactionNeedsFreshBrainUsage) {
    return {
      evaluationId: randomUUID(),
      basis: 'post_compaction' as const,
      budgetTokens: input.currentMessageTokenEstimate,
      contextWindowTokens: input.contextWindowTokens,
      compactionTriggerTokens: input.compactionTriggerTokens,
      hasCompressibleHistory: input.hasCompressibleHistory,
      usageAvailable: true
    }
  }

  const lastBrainInputTokens = input.cache.lastBrainInputTokens
  if (lastBrainInputTokens === undefined) {
    const basis: BrainContextBudgetSnapshot['basis'] = input.cache.lastBrainUsageUnavailable
      ? 'usage_unavailable'
      : 'initial'
    return {
      evaluationId: randomUUID(),
      basis,
      budgetTokens: input.currentMessageTokenEstimate,
      contextWindowTokens: input.contextWindowTokens,
      compactionTriggerTokens: input.compactionTriggerTokens,
      hasCompressibleHistory: input.hasCompressibleHistory,
      usageAvailable: true
    }
  }

  const deltaTokenEstimate = Math.max(
    0,
    input.currentMessageTokenEstimate - (input.cache.lastBrainMessageTokenEstimate || 0)
  )
  return {
    evaluationId: randomUUID(),
    basis: 'usage_plus_delta' as const,
    budgetTokens: lastBrainInputTokens + deltaTokenEstimate,
    contextWindowTokens: input.contextWindowTokens,
    compactionTriggerTokens: input.compactionTriggerTokens,
    hasCompressibleHistory: input.hasCompressibleHistory,
    usageAvailable: true,
    lastBrainInputTokens,
    deltaTokenEstimate
  }
}

export const createContextBudgetNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const contextWindowTokens =
      input.ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    const compactionTriggerTokens = Math.floor(
      contextWindowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO
    )
    const messages = input.cache.messages || []
    const { compressible: compressibleMessages } = splitMessagesByLastAi(messages)
    const hasCompressibleHistory = compressibleMessages.length > 0
    const compressibleTokenEstimate = estimateMessagesForContext(compressibleMessages)
    const currentMessageTokenEstimate = estimateMessagesForContext(messages)
    const currentUser = messages.find(isCurrentBrainUserMessage)
    if (currentUser && estimateMessagesForContext([currentUser]) > contextWindowTokens) {
      throw new LlmInputTooLongError()
    }
    const minimumCompressibleTokens = Math.floor(
      contextWindowTokens * CONTEXT_COMPACTION_MIN_SOURCE_RATIO
    )
    const contextBudgetSnapshot = buildBudgetSnapshot({
      cache: input.cache,
      contextWindowTokens,
      compactionTriggerTokens,
      hasCompressibleHistory,
      currentMessageTokenEstimate
    })
    const shouldCompact =
      contextBudgetSnapshot.usageAvailable &&
      contextBudgetSnapshot.budgetTokens > compactionTriggerTokens &&
      hasCompressibleHistory &&
      compressibleTokenEstimate >= minimumCompressibleTokens
    const createdAt = Date.now()
    const decision = shouldCompact ? 'compact' : 'continue'
    input.ctx.sendEvent({
      type: 'context_budget_evaluated',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      stage: 'human_brain',
      decision,
      snapshot: contextBudgetSnapshot,
      createdAt
    })

    if (!shouldCompact && !input.cache.currentUserLogAppended) {
      await input.ctx.appendMessageLog([
        {
          kind: 'user',
          content: state.task.userInput,
          context: {
            selectedReferences: input.ctx.referenceScope.selectedReferences,
            attachments: input.ctx.referenceScope.attachments
          }
        }
      ])
      input.cache.currentUserLogAppended = true
    }

    return {
      ...state,
      execution: {
        ...state.execution,
        stage: shouldCompact ? 'context_compaction' : 'brain',
        contextBudget: contextBudgetSnapshot
      }
    }
  }
}
