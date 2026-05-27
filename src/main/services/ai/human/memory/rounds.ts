import { extractArtifactRefsFromToolResult, extractArtifactRefsFromToolResults } from '../../utils/artifacts'
import {
  renderToolDiagnosticText
} from '../shared/toolResultRenderers'
import type {
  HumanHistoryToolResult,
  HumanLearningOutcome,
  HumanRoundExecution,
  HumanRoundRecord,
  HumanState,
  HumanDecisionHint,
  ToolCallResult,
  HandCallList
} from '../types'
import { HUMAN_HISTORY_LIMITS } from './constants'

const nextRoundId = (rounds: HumanState['memory']['taskRun']['rounds']): number =>
  (rounds.at(-1)?.roundId || 0) + 1

const trimRoundHistory = (
  rounds: HumanState['memory']['taskRun']['rounds']
): HumanState['memory']['taskRun']['rounds'] =>
  rounds.slice(-HUMAN_HISTORY_LIMITS.rounds)

export const buildHistoryToolResult = (result: ToolCallResult): HumanHistoryToolResult => {
  const diagnosticText = renderToolDiagnosticText(result).replace(/^；/, '').trim() || undefined
  return {
    toolName: result.toolName,
    ok: result.ok,
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
  decisionHint: HumanDecisionHint
): Extract<HumanRoundExecution, { kind: 'pre_execution_blocked' }> => ({
  kind: 'pre_execution_blocked',
  decisionHint
})

export const buildLearningExecution = (input: {
  learningOutcome: HumanLearningOutcome
  decisionHint?: HumanDecisionHint
}): Extract<HumanRoundExecution, { kind: 'learning' }> => ({
  kind: 'learning',
  learningOutcome: input.learningOutcome,
  decisionHint: input.decisionHint
})

export const buildHandExecution = (input: {
  calls: HandCallList
  toolResults: ToolCallResult[]
  decisionHint?: HumanDecisionHint
}): Extract<HumanRoundExecution, { kind: 'hand' }> => {
  const artifactRefs = extractArtifactRefsFromToolResults(input.toolResults)
  return {
    kind: 'hand',
    calls: input.calls,
    toolResults: input.toolResults.map(buildHistoryToolResult),
    decisionHint: input.decisionHint,
    artifactRefs: artifactRefs.length > 0 ? artifactRefs : undefined
  }
}

export const buildMouthExecution = (): Extract<HumanRoundExecution, { kind: 'mouth' }> => ({
  kind: 'mouth',
  action: 'deliver_result'
})

export const appendRoundRecord = (input: {
  state: HumanState
  thought: HumanRoundRecord['thought']
  execution: HumanRoundExecution
  createdAt?: number
}): HumanState['memory']['taskRun'] => ({
  ...input.state.memory.taskRun,
  rounds: trimRoundHistory([
    ...input.state.memory.taskRun.rounds,
    {
      roundId: nextRoundId(input.state.memory.taskRun.rounds),
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
}): HumanState['memory']['taskRun'] => {
  if (!input.state.execution.currentThought) {
    return input.state.memory.taskRun
  }

  return appendRoundRecord({
    state: input.state,
    thought: input.state.execution.currentThought,
    execution: input.execution,
    createdAt: input.createdAt
  })
}

export const getLastRoundFocus = (state: HumanState): HumanRoundRecord | undefined =>
  state.memory.taskRun.rounds.at(-1)

export const getRecentHistoryRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.taskRun.rounds
    .slice(0, -1)
    .slice(-HUMAN_HISTORY_LIMITS.recentHistoryRounds)

export const getCompressibleHistoryRounds = (state: HumanState): HumanRoundRecord[] =>
  state.memory.taskRun.rounds.slice(0, -1)
