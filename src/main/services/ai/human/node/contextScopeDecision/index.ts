import { z } from 'zod/v4'
import { SystemMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanContextScopeDecision, HumanState } from '../../types'
import {
  resolveContextScopeDecisionTokens,
  resolveContextWindowTokens
} from '../../constants'
import { estimateMessagesForContext } from '../../memory/multimodal'
import { projectBrainMessagesFromLog } from '../../memory/brainMessageProjection'
import {
  collectRunDigestCatalogEntries,
  renderRunDigestCatalog
} from '../../memory/runDigestCatalog'
import {
  resolveLastConversationRunId,
  resolveMaxMessageLogSeq,
  runHasDigest
} from '../../memory/transcript'
import { buildBrainSystemPrompt } from '../../prompts/brain'
import { buildContextScopeDecisionPrompt } from '../../prompts/contextScope'

export type ContextScopeDecision = HumanContextScopeDecision

const contextScopeDecisionSchema = z.object({
  needsHistory: z.boolean(),
  reason: z.string()
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
  const catalogText = renderRunDigestCatalog(collectRunDigestCatalogEntries(input.records))
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
      temperature: 0.1
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
  if (lastRunId && !runHasDigest(input.records, lastRunId)) {
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

export const buildContextScopeSelectedEntry = (input: {
  decision: ContextScopeDecision
  records: readonly ChatMessageLogRecord[]
}): ChatMessageLogEntry => {
  const discardThroughSeq =
    !input.decision.needsHistory ? resolveMaxMessageLogSeq(input.records) : undefined
  return {
    kind: 'annotation',
    eventType: 'context_scope_selected',
    payload: {
      needsHistory: input.decision.needsHistory,
      basis: input.decision.basis,
      budgetTokens: input.decision.budgetTokens,
      ...(typeof discardThroughSeq === 'number' && discardThroughSeq >= 0
        ? { discardThroughSeq }
        : {})
    }
  }
}
