import { z } from 'zod/v4'
import { SystemMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanContextScopeDecision, HumanState } from '../../types'
import {
  resolveContextScopeDecisionTokens,
  resolveContextWindowTokens,
  resolveDiscardHistoryTokens
} from '../../constants'
import { estimateMessagesForContext } from '../../memory/multimodal'
import { projectBrainMessagesFromLog } from '../../memory/brainMessageProjection'
import {
  collectRunDigestCatalogEntries,
  assembleConversationHistory,
  renderRunDigestCatalog
} from '../../memory/runDigestCatalog'
import {
  resolveHistoryFloor,
  resolveLastConversationRunId,
  resolveMaxMessageLogSeq,
  runHasDigest
} from '../../memory/transcript'
import { buildBrainSystemPrompt } from '../../prompts/brain'
import { buildContextScopeDecisionPrompt } from '../../prompts/contextScope'

export type ContextScopeDecision = HumanContextScopeDecision

const contextScopeDecisionSchema = z.object({
  needsHistory: z.boolean()
})

const buildFullHistoryMessages = (input: {
  records: ChatMessageLogRecord[]
  ctx: AiRunContext
  state: HumanState
}) => {
  const projection = projectBrainMessagesFromLog({
    records: input.records,
    ctx: input.ctx,
    state: input.state,
    needsHistory: true
  })
  return [new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })), ...projection.messages]
}

const decideByModel = async (input: {
  ctx: AiRunContext
  state: HumanState
  records: ChatMessageLogRecord[]
  budgetTokens: number
}): Promise<ContextScopeDecision> => {
  const floor = resolveHistoryFloor(input.records)
  const liveRecords = input.records.filter((record) => record.seq > floor.historyFloorSeq)
  const catalogText = renderRunDigestCatalog(collectRunDigestCatalogEntries(liveRecords))
  const prompt = buildContextScopeDecisionPrompt({
    catalogText,
    taskGoal: input.state.task.userInput
  })
  try {
    const result = await input.ctx.chatStructured({
      caller: 'human.context_scope',
      taskId: input.state.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schema: contextScopeDecisionSchema,
      schemaName: 'human_context_scope',
      temperature: 0.1,
      retryOutputErrors: true
    })
    return {
      needsHistory: result.output.needsHistory,
      basis: 'model_decision',
      budgetTokens: input.budgetTokens
    }
  } catch {
    return {
      needsHistory: true,
      basis: 'fallback',
      budgetTokens: input.budgetTokens
    }
  }
}

export const decideContextScope = async (input: {
  ctx: AiRunContext
  state: HumanState
  records: ChatMessageLogRecord[]
}): Promise<ContextScopeDecision> => {
  const lastRunId = resolveLastConversationRunId(input.records)
  if (!lastRunId) {
    return {
      needsHistory: true,
      basis: 'gate_below_threshold',
      budgetTokens: 0
    }
  }
  if (!runHasDigest(input.records, lastRunId)) {
    return {
      needsHistory: true,
      basis: 'gate_incomplete_run',
      budgetTokens: 0
    }
  }

  const contextWindowTokens = resolveContextWindowTokens(
    input.ctx.humanRuntimeOverrides?.modelContextWindowTokens
  )
  const decisionTokens = resolveContextScopeDecisionTokens(contextWindowTokens)
  const fullMessages = buildFullHistoryMessages(input)
  const budgetTokens = estimateMessagesForContext(fullMessages)
  if (budgetTokens <= decisionTokens) {
    return {
      needsHistory: true,
      basis: 'gate_below_threshold',
      budgetTokens
    }
  }

  return decideByModel({
    ctx: input.ctx,
    state: input.state,
    records: input.records,
    budgetTokens
  })
}

export const buildContextScopeDecidedEntry = (
  decision: ContextScopeDecision
): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'context_scope_decided',
  payload: {
    needsHistory: decision.needsHistory,
    basis: decision.basis,
    budgetTokens: decision.budgetTokens
  }
})

export const buildDiscardCheckpointEntry = (input: {
  records: readonly ChatMessageLogRecord[]
  contextWindowTokens: number
}): ChatMessageLogEntry | undefined => {
  const throughSeq = resolveMaxMessageLogSeq(input.records)
  if (throughSeq < 0) return undefined
  return {
    kind: 'annotation',
    eventType: 'discard_checkpoint',
    payload: {
      throughSeq,
      conversationHistory: assembleConversationHistory(
        input.records,
        resolveDiscardHistoryTokens(input.contextWindowTokens)
      )
    }
  }
}

export const buildContextScopeLogEntries = (input: {
  decision: ContextScopeDecision
  records: readonly ChatMessageLogRecord[]
  contextWindowTokens: number
}): ChatMessageLogEntry[] => {
  const entries: ChatMessageLogEntry[] = [buildContextScopeDecidedEntry(input.decision)]
  if (!input.decision.needsHistory) {
    const discard = buildDiscardCheckpointEntry({
      records: input.records,
      contextWindowTokens: input.contextWindowTokens
    })
    if (discard) entries.push(discard)
  }
  return entries
}
