import { extractArtifactRefsFromToolResult, extractArtifactRefsFromToolResults } from '../../utils/artifacts'
import {
  buildToolCallDisplayText,
  renderToolDiagnosticText,
  renderToolResultDataPreview
} from '../shared/toolResultRenderers'
import { historyRecallFilterSchema, humanLoadedHistoryContextSchema } from '../schema'
import type {
  HumanHistoryToolResult,
  HumanLoadedHistoryContext,
  HumanLearningOutcome,
  HumanRoundExecution,
  HumanRoundExecutionKind,
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
    dataPreview: renderToolResultDataPreview(result),
    diagnosticText,
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
  summary: string
  completed: boolean
}): Extract<HumanRoundExecution, { kind: 'mouth' }> => ({
  kind: 'mouth',
  summary: input.summary,
  completed: input.completed
})

export const appendRoundRecord = (input: {
  state: HumanState
  decision: HumanRoundRecord['decision']
  execution: HumanRoundExecution
  createdAt?: number
}): HumanState['memory']['history'] => ({
  ...input.state.memory.history,
  roundHistory: trimRoundHistory([
    ...input.state.memory.history.roundHistory,
    {
      roundId: nextRoundId(input.state.memory.history.roundHistory),
      createdAt: input.createdAt || Date.now(),
      decision: input.decision,
      execution: input.execution
    }
  ])
})

export const appendDecisionRound = (input: {
  state: HumanState
  execution: HumanRoundExecution
  createdAt?: number
}): HumanState['memory']['history'] => {
  if (!input.state.execution.currentDecision) {
    return input.state.memory.history
  }

  return appendRoundRecord({
    state: input.state,
    decision: input.state.execution.currentDecision,
    execution: input.execution,
    createdAt: input.createdAt
  })
}

export const getLastRoundFocus = (state: HumanState): HumanRoundRecord | undefined =>
  state.memory.history.roundHistory.at(-1)

export const getHistoryChainRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.history.roundHistory.slice(0, -1).slice(-HUMAN_HISTORY_LIMITS.historyChain)

export const getLoadedHistoryContext = (
  state: HumanState
): HumanLoadedHistoryContext | undefined => state.memory.history.loadedHistoryContext

const readExecutionWatchHint = (execution: HumanRoundExecution): HumanWatchHint | undefined =>
  execution.kind === 'pre_execution_blocked' ||
  execution.kind === 'learning' ||
  execution.kind === 'hand'
    ? execution.watchHint
    : undefined

const matchesExecutionKind = (
  execution: HumanRoundExecution,
  expectedKinds: HumanRoundExecutionKind[] | undefined
): boolean => !expectedKinds || expectedKinds.includes(execution.kind)

const matchesToolNames = (
  execution: HumanRoundExecution,
  toolNames: string[] | undefined
): boolean => {
  if (!toolNames || toolNames.length === 0) return true
  if (execution.kind !== 'hand') return false

  const expected = new Set(toolNames.map((toolName) => String(toolName || '').trim()))
  return execution.toolResults.some((result) => expected.has(result.toolName))
}

const matchesWatchHintCodes = (
  execution: HumanRoundExecution,
  watchHintCodes: HumanWatchHint['code'][] | undefined
): boolean => {
  if (!watchHintCodes || watchHintCodes.length === 0) return true
  const watchHint = readExecutionWatchHint(execution)
  return Boolean(watchHint && watchHintCodes.includes(watchHint.code))
}

export const filterRoundHistory = (input: {
  roundHistory: HumanRoundRecord[]
  filters: HumanLoadedHistoryContext['filters']
}): HumanRoundRecord[] => {
  const filters = historyRecallFilterSchema.parse(input.filters)
  const roundIds = filters.roundIds ? new Set(filters.roundIds) : undefined

  return input.roundHistory
    .filter((record) => {
      if (roundIds && !roundIds.has(record.roundId)) return false
      if (!matchesExecutionKind(record.execution, filters.executionKinds)) return false
      if (!matchesToolNames(record.execution, filters.toolNames)) return false
      if (!matchesWatchHintCodes(record.execution, filters.watchHintCodes)) return false
      return true
    })
    .slice(-Math.max(1, filters.limit || HUMAN_HISTORY_LIMITS.loadedHistoryRounds))
}

export const buildLoadedHistoryContext = (input: {
  filters: HumanLoadedHistoryContext['filters']
  rounds: HumanRoundRecord[]
}): HumanLoadedHistoryContext => ({
  filters: historyRecallFilterSchema.parse(input.filters),
  rounds: input.rounds.slice(0, HUMAN_HISTORY_LIMITS.loadedHistoryRounds)
})

export const readLoadedHistoryContextFromToolResults = (
  results: readonly ToolCallResult[]
): HumanLoadedHistoryContext | undefined => {
  const data = results.find((result) => result.toolName === 'history_recall')?.data
  const parsed = humanLoadedHistoryContextSchema.safeParse(data)
  return parsed.success ? parsed.data : undefined
}
