import { randomUUID } from 'node:crypto'
import { HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../../../types'
import { getCompressibleHistoryRounds, getLastRoundFocus } from '../../memory/rounds'
import { deriveMessagesFromRounds } from '../../memory/messages'
import { CONTEXT_COMPACTION_TARGET_RATIO } from '../../constants'
import { buildHistoryCompactionPrompt } from '../../prompts/compaction'
import { renderBrainRoundSection } from '../../shared/historyRenderers'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimateTextTokens } from '../../utils/tokenEstimate'
import { emitCompactionCompleted, emitCompactionStarted } from '../../../events/processEvents'

export const createContextCompactionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const targetRounds = getCompressibleHistoryRounds(state)
    const latestRound = getLastRoundFocus(state)
    if (targetRounds.length === 0) {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'brain'
        }
      }
    }

    const currentHistoryBlock =
      state.memory.taskRun.compactions.find((block) => block.kind === 'rounds') || null
    const mergedRoundIds = Array.from(
      new Set([
        ...(currentHistoryBlock?.source.roundIds || []),
        ...targetRounds.map((round) => round.roundId)
      ])
    )
    const budgetTokensBefore = state.execution.contextBudget?.budgetTokens || 0
    emitCompactionStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_started',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      targetRoundIds: targetRounds.map((round) => round.roundId),
      budgetTokensBefore,
      thresholdTokens: state.execution.contextBudget?.compactionTriggerTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain'
    })

    const historyRounds = renderBrainRoundSection(targetRounds)
    const prompt = buildHistoryCompactionPrompt({
      userGoal: state.task.userInput,
      existingCompactSummary: currentHistoryBlock?.summary,
      historyRounds,
      targetCompressionRatio: CONTEXT_COMPACTION_TARGET_RATIO
    })
    const sourceHistoryTokenEstimate = estimateTextTokens(historyRounds)
    const summary = await input.ctx.chatText({
      caller: 'human.context_compaction',
      taskId: state.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_history_compaction',
      temperature: 0.1
    })
    const tokenEstimateAfter = estimateTextTokens(summary)
    const compactBlockId = randomUUID()
    const compactBlock = {
      id: compactBlockId,
      kind: 'rounds' as const,
      summary: String(summary || '').trim() || '已压缩较早过程历史。',
      source: {
        roundIds: mergedRoundIds
      },
      createdAt: Date.now(),
      tokenEstimateBefore: budgetTokensBefore,
      sourceHistoryTokenEstimate,
      tokenEstimateAfter
    }

    emitCompactionCompleted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
    input.ctx.sendEvent({
      type: 'context_compaction_completed',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      compactBlockId,
      sourceRoundIds: mergedRoundIds,
      tokenEstimateBefore: budgetTokensBefore,
      sourceHistoryTokenEstimate,
      tokenEstimateAfter,
      summaryPreview: compactBlock.summary,
      completedAt: Date.now(),
      stage: 'human_brain'
    })
    input.cache.lastBrainInputTokens = undefined
    input.cache.lastBrainRoundCount = undefined
    input.cache.lastBrainUsageUnavailable = false
    input.cache.postCompactionNeedsFreshBrainUsage = true

    const remainingRounds = latestRound ? [latestRound] : []
    input.cache.compactSummaryText = String(summary || '').trim()
    const prefix = input.cache.prefixMessages || []
    const rebuilt: BaseMessage[] = [...prefix]
    if (input.cache.compactSummaryText) {
      rebuilt.push(
        new HumanMessage(
          `<compacted_history>\n${input.cache.compactSummaryText}\n</compacted_history>`
        )
      )
    }
    rebuilt.push(...deriveMessagesFromRounds(remainingRounds))
    input.cache.messages = rebuilt

    return {
      ...state,
      execution: {
        ...state.execution,
        stage: 'brain'
      },
      memory: {
        ...state.memory,
        taskRun: {
          compactions: [
            ...state.memory.taskRun.compactions.filter((block) => block.kind !== 'rounds'),
            compactBlock
          ],
          rounds: remainingRounds
        }
      }
    }
  }
}
