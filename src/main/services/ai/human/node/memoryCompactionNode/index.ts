import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../types'
import { getCompressibleHistoryRounds, getLastRoundFocus } from '../../memory/roundHistory'
import { buildHistoryCompactionPrompt } from '../../prompts/compaction'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { estimateTextTokens } from '../../utils/tokenEstimate'

export const createMemoryCompactionNode = (input: {
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

    const tokenEstimateBefore = state.execution.contextBudget?.tokenEstimate || 0
    input.ctx.sendEvent({
      type: 'context_compaction_started',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      targetRoundIds: targetRounds.map((round) => round.roundId),
      tokenEstimateBefore,
      thresholdTokens: state.execution.contextBudget?.triggerTokens || 0,
      createdAt: Date.now(),
      stage: 'human_brain'
    })

    const prompt = buildHistoryCompactionPrompt({ state })
    const summary = await input.ctx.chatText({
      caller: 'human.memory_compaction',
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
      kind: 'history' as const,
      summary: String(summary || '').trim() || '已压缩较早过程历史。',
      source: {
        roundIds: targetRounds.map((round) => round.roundId)
      },
      createdAt: Date.now(),
      tokenEstimateBefore,
      tokenEstimateAfter
    }

    input.ctx.sendEvent({
      type: 'context_compaction_completed',
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      compactBlockId,
      sourceRoundIds: compactBlock.source.roundIds,
      tokenEstimateBefore,
      tokenEstimateAfter,
      completedAt: Date.now(),
      stage: 'human_brain'
    })

    return {
      ...state,
      execution: {
        ...state.execution,
        stage: 'brain'
      },
      memory: {
        ...state.memory,
        history: {
          compactBlocks: [...state.memory.history.compactBlocks, compactBlock],
          roundHistory: latestRound ? [latestRound] : []
        }
      }
    }
  }
}
