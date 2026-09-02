import { randomUUID } from 'node:crypto'
import { HumanMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../../../types'
import { CONTEXT_COMPACTION_TARGET_RATIO } from '../../constants'
import { buildHistoryCompactionPrompt } from '../../prompts/compaction'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimateTextTokens } from '../../utils/tokenEstimate'
import { emitCompactionCompleted, emitCompactionStarted } from '../../../events/processEvents'
import { renderMessagesForCompaction, splitMessagesByLastAi } from '../utils/messageTail'

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const messages = input.cache.messages || []
    const { compressible } = splitMessagesByLastAi(messages)
    if (compressible.length === 0) {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'brain'
        }
      }
    }

    const currentHistoryBlock =
      state.memory.compactions.find((block) => block.kind === 'compacted_history') || null
    const budgetTokensBefore = state.execution.contextBudget?.budgetTokens || 0
    emitCompactionStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_started',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      targetMessageCount: compressible.length,
      budgetTokensBefore,
      thresholdTokens: state.execution.contextBudget?.compactionTriggerTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain'
    })

    const historyText = renderMessagesForCompaction(compressible)
    const prompt = buildHistoryCompactionPrompt({
      userGoal: state.task.userInput,
      existingCompactSummary: currentHistoryBlock?.summary,
      historyText,
      targetCompressionRatio: CONTEXT_COMPACTION_TARGET_RATIO
    })
    const sourceHistoryTokenEstimate = estimateTextTokens(historyText)
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
      summary: String(summary || '').trim() || '已压缩较早过程历史。',
      createdAt: Date.now(),
      tokenEstimateBefore: budgetTokensBefore,
      sourceHistoryTokenEstimate,
      tokenEstimateAfter
    }

    const currentRecords = await input.ctx.loadMessageLog()
    const currentUserRecord = currentRecords.find(
      (record) => record.runId === input.ctx.runId && record.entry.kind === 'user'
    )
    const coveredRecord = currentUserRecord
      ? [...currentRecords].reverse().find((record) => record.seq < currentUserRecord.seq)
      : [...currentRecords].reverse()[0]
    if (!coveredRecord) {
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
          coveredThroughSeq: coveredRecord.seq,
          sourceMessageCount: compressible.length
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
      sourceMessageCount: compressible.length,
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
    const compressibleSet = new Set(compressible)
    const firstCompressibleIndex = messages.findIndex((message) => compressibleSet.has(message))
    const rebuilt = messages.filter((message) => !compressibleSet.has(message))
    const summaryMessage = new HumanMessage(
      `<compacted_history>\n${compactBlock.summary}\n</compacted_history>`
    )
    rebuilt.splice(Math.max(1, firstCompressibleIndex), 0, summaryMessage)
    input.cache.messages = rebuilt
    input.cache.currentUserMessageIndex = rebuilt.findIndex(
      (message) => message.additional_kwargs?.ncurator_current_user === true
    )

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
