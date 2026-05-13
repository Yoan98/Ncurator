import { extractArtifactRefsFromToolResult, extractArtifactRefsFromToolResults } from '../../utils/artifacts'
import {
  buildToolCallDisplayText,
  renderToolDiagnosticText
} from '../shared/toolResultRenderers'
import type {
  HumanHistoryToolResult,
  HumanLearningOutcome,
  HumanRoundExecution,
  HumanRoundRecord,
  HumanState,
  HumanWatchHint,
  ToolCallResult,
  ToolUsePlan
} from '../types'
import { HUMAN_HISTORY_LIMITS } from './constants'

const nextRoundId = (roundHistory: HumanState['memory']['history']['roundHistory']): number =>
  (roundHistory.at(-1)?.roundId || 0) + 1

const trimRoundHistory = (
  roundHistory: HumanState['memory']['history']['roundHistory']
): HumanState['memory']['history']['roundHistory'] =>
  roundHistory.slice(-HUMAN_HISTORY_LIMITS.roundHistory)

export const buildHistoryToolResult = (result: ToolCallResult): HumanHistoryToolResult => {
  const diagnosticText = renderToolDiagnosticText(result).replace(/^；/, '').trim() || undefined
  return {
    toolName: result.toolName,
    ok: result.ok,
    code: result.code,
    summary: buildToolCallDisplayText(result),
    data: result.data,
    diagnosticText,
    resourceContext: result.resourceContext,
    artifactRefs: (() => {
      const refs = extractArtifactRefsFromToolResult(result)
      return refs.length > 0 ? refs : undefined
    })()
  }
}

export const buildPreExecutionBlockedExecution = (
  watchHint: HumanWatchHint
): Extract<HumanRoundExecution, { kind: 'pre_execution_blocked' }> => ({
  kind: 'pre_execution_blocked',
  watchHint
})

export const buildLearningExecution = (input: {
  learningOutcome: HumanLearningOutcome
  watchHint?: HumanWatchHint
}): Extract<HumanRoundExecution, { kind: 'learning' }> => ({
  kind: 'learning',
  learningOutcome: input.learningOutcome,
  watchHint: input.watchHint
})

export const buildHandExecution = (input: {
  toolUsePlan: ToolUsePlan
  toolResults: ToolCallResult[]
  watchHint?: HumanWatchHint
}): Extract<HumanRoundExecution, { kind: 'hand' }> => {
  const artifactRefs = extractArtifactRefsFromToolResults(input.toolResults)
  return {
    kind: 'hand',
    toolUsePlan: input.toolUsePlan,
    toolResults: input.toolResults.map(buildHistoryToolResult),
    watchHint: input.watchHint,
    artifactRefs: artifactRefs.length > 0 ? artifactRefs : undefined
  }
}

export const buildMouthExecution = (input: {
  completed: boolean
}): Extract<HumanRoundExecution, { kind: 'mouth' }> => ({
  kind: 'mouth',
  completed: input.completed
})

export const appendRoundRecord = (input: {
  state: HumanState
  thought: HumanRoundRecord['thought']
  execution: HumanRoundExecution
  createdAt?: number
}): HumanState['memory']['history'] => ({
  ...input.state.memory.history,
  roundHistory: trimRoundHistory([
    ...input.state.memory.history.roundHistory,
    {
      roundId: nextRoundId(input.state.memory.history.roundHistory),
      createdAt: input.createdAt || Date.now(),
      thought: input.thought,
      execution: input.execution
    }
  ])
})

export const appendDecisionRound = (input: {
  state: HumanState
  execution: HumanRoundExecution
  createdAt?: number
}): HumanState['memory']['history'] => {
  if (!input.state.execution.currentThought) {
    return input.state.memory.history
  }

  return appendRoundRecord({
    state: input.state,
    thought: input.state.execution.currentThought,
    execution: input.execution,
    createdAt: input.createdAt
  })
}

export const getLastRoundFocus = (state: HumanState): HumanRoundRecord | undefined =>
  state.memory.history.roundHistory.at(-1)

export const getRecentHistoryRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.history.roundHistory
    .slice(0, -1)
    .slice(-HUMAN_HISTORY_LIMITS.recentHistoryRounds)

export const getCompressibleHistoryRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.history.roundHistory.slice(0, -1)
