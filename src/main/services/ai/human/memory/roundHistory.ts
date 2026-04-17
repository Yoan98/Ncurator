import { extractArtifactRefsFromToolResult, extractArtifactRefsFromToolResults } from '../../utils/artifacts'
import {
  buildToolCallDisplayText,
  renderToolDiagnosticText,
  renderToolResourceContextText,
  renderToolResultDataText
} from '../shared/toolResultRenderers'
import { historySearchFilterSchema, humanLoadedHistoryContextSchema } from '../schema'
import type {
  HumanHistoryToolResult,
  HumanLoadedHistoryContext,
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

export const getEarlierAttemptRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.history.roundHistory
    .slice(0, -1)
    .slice(-HUMAN_HISTORY_LIMITS.earlierAttemptRounds)

export const getLoadedHistoryContext = (
  state: HumanState
): HumanLoadedHistoryContext | undefined => state.memory.history.loadedHistoryContext

const buildRoundSearchText = (record: HumanRoundRecord): string => {
  const segments: string[] = [
    record.decision.decision.summary,
    record.decision.decision.reason,
    record.decision.decision.expectedOutcome
  ]

  if (record.execution.kind === 'learning') {
    segments.push(record.execution.learningOutcome.loadedSkillIds.join(' '))
  } else if (record.execution.kind === 'hand') {
    record.execution.toolResults.forEach((result) => {
      segments.push(
        result.toolName,
        result.summary,
        renderToolResourceContextText(result.resourceContext) || '',
        renderToolResultDataText(result) || '',
        result.diagnosticText || ''
      )
    })
  } else if (record.execution.kind === 'mouth') {
    segments.push(record.execution.summary)
  } else {
    segments.push(record.execution.watchHint.code)
  }

  return segments.join('\n').toLowerCase()
}

const withinRoundRange = (input: {
  record: HumanRoundRecord
  startRoundId?: number
  endRoundId?: number
}): boolean => {
  if (typeof input.startRoundId === 'number' && input.record.roundId < input.startRoundId) return false
  if (typeof input.endRoundId === 'number' && input.record.roundId > input.endRoundId) return false
  return true
}

export const filterRoundHistory = (input: {
  roundHistory: HumanRoundRecord[]
  filters: HumanLoadedHistoryContext['filters']
}): HumanRoundRecord[] => {
  const filters = historySearchFilterSchema.parse(input.filters)
  const limit = Math.max(1, filters.limit || HUMAN_HISTORY_LIMITS.loadedHistoryRounds)
  const query = String(filters.query || '').trim().toLowerCase()

  const scoped = input.roundHistory.filter((record) =>
    withinRoundRange({
      record,
      startRoundId: filters.startRoundId,
      endRoundId: filters.endRoundId
    })
  )

  if (!query) {
    return scoped.slice(-limit)
  }

  return scoped
    .filter((record) => buildRoundSearchText(record).includes(query))
    .slice(-limit)
}

export const buildLoadedHistoryContext = (input: {
  filters: HumanLoadedHistoryContext['filters']
  rounds: HumanRoundRecord[]
}): HumanLoadedHistoryContext => ({
  filters: historySearchFilterSchema.parse(input.filters),
  rounds: input.rounds.slice(0, HUMAN_HISTORY_LIMITS.loadedHistoryRounds)
})

export const readLoadedHistoryContextFromToolResults = (
  results: readonly ToolCallResult[]
): HumanLoadedHistoryContext | undefined => {
  const data = results.find(
    (result) => result.toolName === 'history_search' || result.toolName === 'history_list'
  )?.data
  const parsed = humanLoadedHistoryContextSchema.safeParse(data)
  return parsed.success ? parsed.data : undefined
}
