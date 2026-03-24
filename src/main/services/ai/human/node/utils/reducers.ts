import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type { HumanResult, HumanState, LastBrainDecision } from '../../types'
import type { HumanTraceItemInput } from './trace'
import { appendHumanTraceStep, appendHumanTraceSteps } from './trace'

export const returnToBrainState = (
  state: HumanState,
  overrides: Partial<Omit<HumanState, 'runtime'>> & {
    runtime?: Partial<HumanState['runtime']>
  } = {}
): HumanState => ({
  ...state,
  ...overrides,
  runtime: {
    ...state.runtime,
    ...overrides.runtime,
    stage: 'brain'
  }
})

export const returnToBrainAfterTraceState = (input: {
  state: HumanState
  traceItems: HumanTraceItemInput[]
  watchHint?: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint' | 'trace'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  const traceSteps = appendHumanTraceSteps({
    steps: input.state.trace.steps,
    items: input.traceItems
  })

  return returnToBrainState(input.state, {
    ...input.overrides,
    watchHint: input.watchHint,
    trace: {
      steps: traceSteps
    }
  })
}

export const resolveBrainNextStage = (input: {
  watchHint?: string
  decision: LastBrainDecision
}): HumanState['runtime']['stage'] => {
  if (input.watchHint) return 'brain'
  return input.decision.nextAction.action === 'learning'
    ? 'learning'
    : input.decision.nextAction.action === 'hand'
      ? 'hand'
      : 'mouth'
}

export const applyBrainDecisionState = (input: {
  state: HumanState
  decision: LastBrainDecision
  reducedInside: HumanState['brainMemory']['inside']
  watchHint?: string
}): HumanState => ({
  ...input.state,
  runtime: {
    stage: resolveBrainNextStage({
      watchHint: input.watchHint,
      decision: input.decision
    }),
    status: 'running'
  },
  brainMemory: {
    inside: input.reducedInside,
    outside: {
      ...input.state.brainMemory.outside,
      brainDecisions: [
        ...input.state.brainMemory.outside.brainDecisions,
        {
          ...input.decision,
          createdAt: Date.now()
        }
      ].slice(-HUMAN_MAX_BRAIN_DECISION_HISTORY)
    }
  },
  lastBrainDecision: input.decision,
  watchHint: input.watchHint,
  trace: {
    steps: appendHumanTraceStep({
      steps: input.state.trace.steps,
      item: {
        action: 'brain_decision',
        publicNarrative: input.decision.decision.summary,
        resultStatus: 'ok',
        summary: input.decision.decision.reason
      }
    })
  }
})

export const buildHumanResult = (input: {
  state: HumanState
  summary: string
  deliveryMarkdown: string
}): HumanResult => ({
  status: 'completed',
  summary: input.summary,
  deliveryMarkdown: input.deliveryMarkdown,
  artifacts: input.state.runtimeArtifacts.length > 0 ? [...input.state.runtimeArtifacts] : undefined
})

export const completeHumanTaskState = (input: {
  state: HumanState
  result: HumanResult
}): HumanState => ({
  ...input.state,
  runtime: {
    stage: 'mouth',
    status: 'completed'
  },
  result: input.result,
  trace: {
    steps: appendHumanTraceStep({
      steps: input.state.trace.steps,
      item: {
        action: 'deliver_result',
        publicNarrative: input.result.summary,
        resultStatus: 'ok',
        summary: input.result.summary
      }
    })
  }
})
