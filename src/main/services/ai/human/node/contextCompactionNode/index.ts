import { randomUUID } from 'node:crypto'
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord,
  ContextCompactionCut
} from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { resolveCompactionTailTokens, resolveEffectiveContextWindowTokens } from '../../constants'
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
import { projectBrainMessagesFromLog } from '../../memory/brainMessageProjection'
import {
  hasCompressibleCompactionHistory,
  splitLogForCompactionTail,
  type CompactionLogSplit
} from '../../memory/compactionSplit'
import { messagesFromLogEntries } from '../../memory/conversationLogMessages'
import {
  resolveHistoryFloor,
  resolveMaxMessageLogSeq,
  type HistoryFloor
} from '../../memory/transcript'
import { createCompactedBrainUserMessage, renderMessagesForCompaction } from '../utils/messageTail'
import { createAiRunFailure } from '../../../utils/runFailure'

const returnToContextBudget = (state: HumanState): HumanState => ({
  ...state,
  execution: {
    ...state.execution,
    stage: 'context_budget'
  }
})

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

const messagesFromRecords = (records: ChatMessageLogRecord[]): BaseMessage[] =>
  messagesFromLogEntries(records.map((record) => record.entry))

const buildCompactionCut = (
  split: CompactionLogSplit,
  throughSeq: number,
  floor: HistoryFloor
): ContextCompactionCut => ({
  throughSeq,
  ...(split.firstKeptSeq === undefined ? {} : { firstKeptSeq: split.firstKeptSeq }),
  historyFloorSeq: floor.historyFloorSeq,
  historyFloorKind: floor.compactionCheckpoint ? 'compaction' : 'none',
  isSplitTurn: split.isSplitTurn,
  foldedCount: split.folded.length,
  tailCount: split.tail.length
})

const prependFloorHistoryUsers = (
  records: ChatMessageLogRecord[],
  conversation: BaseMessage[]
): BaseMessage[] => {
  const floor = resolveHistoryFloor(records)
  const prefix: BaseMessage[] = []
  const checkpointSummary = floor.compactionCheckpoint?.summary.trim()
  if (checkpointSummary) {
    prefix.push(createCompactedBrainUserMessage(wrapCompactionCheckpointContent(checkpointSummary)))
  }
  return [...prefix, ...conversation]
}

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const retainTokens = resolveCompactionTailTokens(
      resolveEffectiveContextWindowTokens(input.ctx.humanRuntimeOverrides?.modelContextWindowTokens)
    )
    const currentRecords = await input.ctx.loadMessageLog()
    if (!hasCompressibleCompactionHistory(currentRecords, retainTokens)) {
      return returnToContextBudget(state)
    }

    const split = splitLogForCompactionTail(currentRecords, retainTokens)
    const { folded, history, turnPrefix, isSplitTurn, throughSeq } = split
    if (throughSeq === undefined) {
      throw createAiRunFailure({
        failureCode: 'internal_error',
        rawMessage: 'compaction_bookmark_unresolved'
      })
    }

    const budgetTokensBefore = state.execution.contextBudget?.budgetTokens || 0
    const floor = resolveHistoryFloor(currentRecords)
    const cut = buildCompactionCut(split, throughSeq, floor)
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
      thresholdTokens: state.execution.contextBudget?.contextWindowTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain',
      ...cut
    })

    const historyMessages = prependFloorHistoryUsers(currentRecords, messagesFromRecords(history))
    const historyText = renderMessagesForCompaction(historyMessages)
    const prefixText = isSplitTurn
      ? renderMessagesForCompaction(messagesFromRecords(turnPrefix))
      : ''
    const sourceHistoryTokenEstimate = estimateTextTokens(
      isSplitTurn ? `${historyText}\n${prefixText}` : historyText
    )

    let summary: string
    if (isSplitTurn) {
      const historySummary = historyMessages.length
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

    const checkpointEntry: ChatMessageLogEntry = {
      kind: 'annotation',
      eventType: 'compaction_checkpoint',
      payload: {
        compactBlockId,
        throughSeq,
        sourceMessageCount: folded.length,
        summary: compactBlock.summary
      }
    }
    await input.ctx.appendMessageLog([checkpointEntry])

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
      stage: 'human_brain',
      ...cut
    })
    input.cache.lastBrainInputTokens = undefined
    input.cache.lastBrainMessageTokenEstimate = undefined
    input.cache.postCompactionNeedsFreshBrainUsage = true
    input.cache.lastBrainUsageUnavailable = false

    const projectedRecords: ChatMessageLogRecord[] = [
      ...currentRecords,
      {
        id: compactBlockId,
        partnerId: input.ctx.partnerId,
        runId: input.ctx.runId,
        seq: resolveMaxMessageLogSeq(currentRecords) + 1,
        entry: checkpointEntry,
        createdAt: Date.now()
      }
    ]
    const projection = projectBrainMessagesFromLog({
      records: projectedRecords,
      ctx: input.ctx,
      state,
      appendCurrentUser: false
    })
    input.cache.messages = [
      new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
      ...projection.messages
    ]
    input.cache.conversationProjection = undefined
    input.cache.currentUserMessageIndex = projection.currentUserMessageIndex + 1
    input.cache.currentUserLogAppended = true

    return {
      ...returnToContextBudget(state),
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
