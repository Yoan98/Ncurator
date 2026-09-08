import { randomUUID } from 'node:crypto'
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../../../types'
import { resolveCompactionTailTokens, resolveContextWindowTokens } from '../../constants'
import {
  buildHistoryCompactionPrompt,
  buildTurnPrefixCompactionPrompt,
  joinSplitCompactionSummary,
  wrapCompactionCheckpointContent
} from '../../prompts/compaction'
import { buildBrainSystemPrompt } from '../../prompts/brain'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimateTextTokens } from '../../utils/tokenEstimate'
import { emitCompactionCompleted, emitCompactionStarted } from '../../../events/processEvents'
import { resolveCompactionCoveredThroughSeq } from '../../memory/transcript'
import {
  countTailBookmarkMessages,
  createCompactedBrainUserMessage,
  hasCompressibleCompactionHistory,
  isCurrentBrainUserMessage,
  renderMessagesForCompaction,
  splitMessagesForCompactionTail
} from '../utils/messageTail'

const compactConversation = async (input: {
  ctx: AiRunContext
  taskId: string
  conversationText: string
}): Promise<string> => {
  const prompt = buildHistoryCompactionPrompt({
    conversationText: input.conversationText
  })
  return input.ctx.chatText({
    caller: 'human.context_compaction',
    taskId: input.taskId,
    system: prompt.system,
    user: prompt.user,
    schemaName: 'human_history_compaction',
    temperature: 0.1
  })
}

const compactTurnPrefix = async (input: {
  ctx: AiRunContext
  taskId: string
  conversationText: string
}): Promise<string> => {
  const prompt = buildTurnPrefixCompactionPrompt({
    conversationText: input.conversationText
  })
  return input.ctx.chatText({
    caller: 'human.context_compaction',
    taskId: input.taskId,
    system: prompt.system,
    user: prompt.user,
    schemaName: 'human_history_compaction',
    temperature: 0.1
  })
}

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const messages = input.cache.messages || []
    const retainTokens = resolveCompactionTailTokens(
      resolveContextWindowTokens(input.ctx.humanRuntimeOverrides?.modelContextWindowTokens)
    )
    if (!hasCompressibleCompactionHistory(messages, retainTokens)) {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'brain'
        }
      }
    }

    const split = splitMessagesForCompactionTail(messages, retainTokens)
    const { folded, tail, history, turnPrefix, isSplitTurn } = split
    const budgetTokensBefore = state.execution.contextBudget?.budgetTokens || 0
    emitCompactionStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_started',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      targetMessageCount: folded.length,
      budgetTokensBefore,
      thresholdTokens: state.execution.contextBudget?.compactionTriggerTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain'
    })

    const currentRecords = await input.ctx.loadMessageLog()
    const historyText = renderMessagesForCompaction(isSplitTurn ? history : folded)
    const prefixText = isSplitTurn ? renderMessagesForCompaction(turnPrefix) : ''
    const sourceHistoryTokenEstimate = estimateTextTokens(
      isSplitTurn ? `${historyText}\n${prefixText}` : historyText
    )

    let summary: string
    if (isSplitTurn) {
      const historySummary = history.length
        ? await compactConversation({
            ctx: input.ctx,
            taskId: state.task.taskId,
            conversationText: historyText
          })
        : ''
      const prefixSummary = await compactTurnPrefix({
        ctx: input.ctx,
        taskId: state.task.taskId,
        conversationText: prefixText
      })
      summary = joinSplitCompactionSummary(historySummary, prefixSummary)
    } else {
      summary = await compactConversation({
        ctx: input.ctx,
        taskId: state.task.taskId,
        conversationText: historyText
      })
    }

    const tokenEstimateAfter = estimateTextTokens(String(summary || ''))
    const compactBlockId = randomUUID()
    const compactBlock = {
      id: compactBlockId,
      kind: 'compacted_history' as const,
      summary: String(summary || '').trim() || '已整理当前工作记忆。',
      createdAt: Date.now(),
      tokenEstimateBefore: budgetTokensBefore,
      sourceHistoryTokenEstimate,
      tokenEstimateAfter
    }

    const coveredThroughSeq = resolveCompactionCoveredThroughSeq(
      currentRecords,
      countTailBookmarkMessages(tail)
    )
    if (coveredThroughSeq === undefined) {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'brain'
        }
      }
    }

    await input.ctx.appendMessageLog([
      {
        kind: 'annotation',
        eventType: 'compaction_checkpoint',
        payload: {
          compactBlockId,
          coveredThroughSeq,
          sourceMessageCount: folded.length,
          summary: compactBlock.summary
        }
      }
    ])

    emitCompactionCompleted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_completed',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      compactBlockId,
      sourceMessageCount: folded.length,
      tokenEstimateBefore: budgetTokensBefore,
      sourceHistoryTokenEstimate,
      tokenEstimateAfter,
      summaryPreview: compactBlock.summary,
      completedAt: Date.now(),
      stage: 'human_brain'
    })
    input.cache.lastBrainInputTokens = undefined
    input.cache.lastBrainMessageTokenEstimate = undefined
    input.cache.postCompactionNeedsFreshBrainUsage = true
    input.cache.lastBrainUsageUnavailable = false
    input.cache.messages = buildCompactedMessages({
      ctx: input.ctx,
      summary: compactBlock.summary,
      tail
    })
    input.cache.currentUserMessageIndex = input.cache.messages.findIndex(isCurrentBrainUserMessage)
    input.cache.currentUserLogAppended = true

    return {
      ...state,
      execution: {
        ...state.execution,
        stage: 'brain'
      },
      memory: {
        ...state.memory,
        compactions: [
          ...state.memory.compactions.filter((block) => block.kind !== 'compacted_history'),
          compactBlock
        ]
      }
    }
  }
}

export const buildCompactedMessages = (input: {
  ctx: AiRunContext
  summary: string
  tail?: readonly BaseMessage[]
}): BaseMessage[] => [
  new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
  createCompactedBrainUserMessage(wrapCompactionCheckpointContent(input.summary)),
  ...(input.tail || [])
]
