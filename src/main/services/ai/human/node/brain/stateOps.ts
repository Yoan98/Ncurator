import type { HumanMemory, HumanMemoryPatch, HumanOutcome, HumanState } from '../../types'
import { appendHumanTraceStep } from '../shared/events'

const mergeUniqueStrings = (base: string[], patch: string[] | undefined): string[] => {
  if (!patch) return base
  return Array.from(new Set(patch.map((item) => String(item || '').trim()).filter(Boolean)))
}

export const mergeMemory = (memory: HumanMemory, patch: HumanMemoryPatch): HumanMemory => {
  return {
    constraints: mergeUniqueStrings(memory.constraints, patch.constraints),
    facts: patch.facts ? [...patch.facts] : memory.facts,
    evidence: patch.evidence ? [...patch.evidence] : memory.evidence,
    openQuestions: patch.openQuestions ? mergeUniqueStrings([], patch.openQuestions) : memory.openQuestions,
    focus: {
      current:
        patch.focus && 'current' in patch.focus
          ? patch.focus.current || undefined
          : memory.focus.current
    },
    capabilityFocus: {
      activeStack: memory.capabilityFocus.activeStack
    }
  }
}

export const appendTerminalOutcomeToState = (input: {
  state: HumanState
  nextMemory: HumanMemory
  nextTurn: HumanState['turn']
  outcome: HumanOutcome
}): HumanState => {
  const terminalAction = input.outcome.status === 'completed' ? 'complete_task' : 'block_task'
  const terminalResultStatus = input.outcome.status === 'completed' ? 'ok' : 'blocked'
  const nextStepIndex = input.state.trace.steps.length + 1
  const nextTrace = appendHumanTraceStep({
    steps: input.state.trace.steps,
    step: nextStepIndex,
    action: terminalAction,
    publicNarrative:
      input.outcome.status === 'completed'
        ? '我已经具备完成当前任务的充分依据。'
        : '当前任务无法继续可靠推进，因此在此阻塞。',
    resultStatus: terminalResultStatus,
    summary: input.outcome.summary
  })

  return {
    ...input.state,
    memory: input.nextMemory,
    turn: input.nextTurn,
    outcome: input.outcome,
    trace: {
      steps: nextTrace
    },
    progress: {
      ...input.state.progress,
      phase: 'finalizing'
    }
  }
}

export const applyReasonResultToState = (input: {
  state: HumanState
  nextMemory: HumanMemory
  nextTurn: HumanState['turn']
  outcome?: HumanOutcome
}): HumanState => {
  if (input.outcome) {
    return appendTerminalOutcomeToState({
      state: input.state,
      nextMemory: input.nextMemory,
      nextTurn: input.nextTurn,
      outcome: input.outcome
    })
  }

  return {
    ...input.state,
    memory: input.nextMemory,
    turn: input.nextTurn,
    outcome: undefined,
    progress: {
      ...input.state.progress,
      phase: 'executing'
    }
  }
}
