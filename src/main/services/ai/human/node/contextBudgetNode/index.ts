import { randomUUID } from 'node:crypto'
import type { BrainContextBudgetSnapshot, ChatMessageLogEntry } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import {
  resolveCompactionTailTokens,
  resolveCompactionTriggerTokens,
  resolveContextWindowTokens
} from '../../constants'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { hasCompressibleCompactionHistory } from '../../memory/compactionSplit'
import { estimateMessagesForContext } from '../../memory/multimodal'
import { buildBrainUserMessage } from '../../prompts/brain'
import { isCurrentBrainUserMessage } from '../utils/messageTail'
import { LlmInputTooLongError } from '../../../errors'
import { buildContextScopeLogEntries } from '../contextScopeDecision'

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

    const contextWindowTokens = resolveContextWindowTokens(
      input.ctx.humanRuntimeOverrides?.modelContextWindowTokens
    )
    const compactionTriggerTokens = resolveCompactionTriggerTokens(contextWindowTokens)
    const messages = input.cache.messages || []
    const retainTokens = resolveCompactionTailTokens(contextWindowTokens)
    const currentMessageTokenEstimate = estimateMessagesForContext(messages)
    const currentUser = messages.find(isCurrentBrainUserMessage)
    if (currentUser && estimateMessagesForContext([currentUser]) > contextWindowTokens) {
      throw new LlmInputTooLongError()
    }

    if (!input.cache.currentUserLogAppended) {
      const builtText = String(
        currentUser?.content ||
          buildBrainUserMessage({
            state,
            ctx: input.ctx
          })
      ).trim()
      if (!builtText) {
        throw new Error('当前 build user 文本为空，无法写入消息日志。')
      }
      const entries: ChatMessageLogEntry[] = []
      if (input.cache.contextScopeDecision) {
        const records = await input.ctx.loadMessageLog()
        entries.push(
          ...buildContextScopeLogEntries({
            decision: input.cache.contextScopeDecision,
            records,
            contextWindowTokens
          })
        )
      }
      entries.push({
        kind: 'user',
        content: builtText,
        input: state.task.userInput,
        context: {
          selectedReferences: input.ctx.referenceScope.selectedReferences,
          attachments: input.ctx.referenceScope.attachments
        }
      })
      await input.ctx.appendMessageLog(entries)
      input.cache.currentUserLogAppended = true
    }

    const records = await input.ctx.loadMessageLog()
    const hasCompressibleHistory = hasCompressibleCompactionHistory(records, retainTokens)
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
      hasCompressibleHistory
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
