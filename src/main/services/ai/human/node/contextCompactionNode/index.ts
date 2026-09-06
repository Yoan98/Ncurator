import { randomUUID } from 'node:crypto'
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../../../types'
import { buildHistoryCompactionPrompt } from '../../prompts/compaction'
import { buildBrainSystemPrompt, buildBrainUserMessage } from '../../prompts/brain'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimateTextTokens } from '../../utils/tokenEstimate'
import { emitCompactionCompleted, emitCompactionStarted } from '../../../events/processEvents'
import { persistCurrentBrainUserSnapshot } from '../../memory/brainUserSnapshot'
import { resolveCompactionCoveredThroughSeq } from '../../memory/transcript'
import {
  createCurrentBrainUserMessage,
  listFoldableHistoryMessages,
  renderMessagesForCompaction,
  splitMessagesForMemoryCompaction
} from '../utils/messageTail'

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const messages = input.cache.messages || []
    const foldable = listFoldableHistoryMessages(messages)
    if (foldable.length === 0) {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'brain'
        }
      }
    }

    const { current, earlier } = splitMessagesForMemoryCompaction(messages)
    const budgetTokensBefore = state.execution.contextBudget?.budgetTokens || 0
    emitCompactionStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_started',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      targetMessageCount: current.length + earlier.length,
      budgetTokensBefore,
      thresholdTokens: state.execution.contextBudget?.compactionTriggerTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain'
    })

    const prompt = buildHistoryCompactionPrompt({
      currentText: renderMessagesForCompaction(current),
      earlierText: renderMessagesForCompaction(earlier)
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
    const coveredThroughSeq = resolveCompactionCoveredThroughSeq(currentRecords)
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
          summary: compactBlock.summary,
          coveredThroughSeq,
          sourceMessageCount: current.length + earlier.length
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
      sourceMessageCount: current.length + earlier.length,
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
      state: {
        ...state,
        memory: {
          ...state.memory,
          compactions: [
            ...state.memory.compactions.filter((block) => block.kind !== 'compacted_history'),
            compactBlock
          ]
        }
      },
      summary: compactBlock.summary
    })
    input.cache.messages = rebuilt
    input.cache.currentUserMessageIndex = rebuilt.findIndex(
      (message) => message.additional_kwargs?.ncurator_current_user === true
    )
    const compactedUserIndex = input.cache.currentUserMessageIndex
    const compactedUserText =
      compactedUserIndex !== undefined && compactedUserIndex >= 0
        ? String(rebuilt[compactedUserIndex]?.content || '')
        : ''
    await persistCurrentBrainUserSnapshot({
      ctx: input.ctx,
      cache: input.cache,
      text: compactedUserText
    })

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
  state: HumanState
  summary: string
}): BaseMessage[] => [
  new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
  createCurrentBrainUserMessage(
    buildBrainUserMessage({
      state: input.state,
      ctx: input.ctx,
      memoryText: input.summary,
      injectActiveState: true
    })
  )
]
