import { randomUUID } from 'node:crypto'
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../../../types'
import { resolveCompactionKeepRecentTokens } from '../../constants'
import {
  buildHistoryCompactionPrompt,
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

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const messages = input.cache.messages || []
    const retainTokens = resolveCompactionKeepRecentTokens(
      input.ctx.humanRuntimeOverrides?.keepRecentTokens
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

    const { folded, tail } = splitMessagesForCompactionTail(messages, retainTokens)
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

    const prompt = buildHistoryCompactionPrompt({
      conversationText: renderMessagesForCompaction(folded)
    })
    const sourceHistoryTokenEstimate = estimateTextTokens(`${prompt.user}`)
    const summary = await input.ctx.chatText({
      caller: 'human.context_compaction',
      taskId: state.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_history_compaction',
      temperature: 0.1
    })
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

    const currentRecords = await input.ctx.loadMessageLog()
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
          sourceMessageCount: folded.length
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
    const rebuilt = buildCompactedMessages({
      ctx: input.ctx,
      summary: compactBlock.summary,
      tail
    })
    const compactedUserText = String(rebuilt[1]?.content || '').trim()
    if (!compactedUserText) {
      throw new Error('compaction user 文本为空，无法写入消息日志。')
    }
    await input.ctx.appendMessageLog([
      {
        kind: 'user',
        content: compactedUserText,
        origin: 'compaction',
        context: {
          selectedReferences: [],
          attachments: []
        }
      }
    ])
    input.cache.messages = rebuilt
    input.cache.currentUserMessageIndex = rebuilt.findIndex(isCurrentBrainUserMessage)
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
