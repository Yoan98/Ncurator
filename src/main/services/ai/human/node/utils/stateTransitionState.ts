import {
  appendDecisionRound,
  appendRoundRecord,
  buildMouthExecution,
  buildPreExecutionBlockedExecution
} from '../../memory/roundHistory'
import type {
  HumanDecision,
  HumanResult,
  HumanStableMemory,
  HumanState,
  HumanTraceStep,
  HumanWatchHint
} from '../../types'

export type HumanTraceItemInput = {
  action: HumanTraceStep['action']
  publicNarrative: string
  resultStatus?: HumanTraceStep['resultStatus']
  skillId?: HumanTraceStep['skillId']
  toolName?: string
  summary: string
}

export type HumanStateOverrides<TExcluded extends keyof HumanState = never> = Partial<
  Omit<HumanState, 'execution' | TExcluded>
> & {
  execution?: Partial<HumanState['execution']>
}

const appendHumanTraceSteps = (input: {
  steps: HumanTraceStep[]
  items: HumanTraceItemInput[]
}): HumanTraceStep[] =>
  input.items.reduce(
    (steps, item) =>
      appendHumanTraceStep({
        steps,
        item
      }),
    input.steps
  )

export const appendHumanTraceStep = (input: {
  steps: HumanTraceStep[]
  item: HumanTraceItemInput
}): HumanTraceStep[] => {
  const step = input.steps.length + 1
  return [
    ...input.steps,
    {
      step,
      action: input.item.action,
      publicNarrative: input.item.publicNarrative,
      resultStatus: input.item.resultStatus,
      skillId: input.item.skillId,
      toolName: input.item.toolName,
      summary: input.item.summary
    }
  ]
}

export const returnToBrainState = (
  state: HumanState,
  overrides: HumanStateOverrides = {}
): HumanState => ({
  ...state,
  ...overrides,
  execution: {
    ...state.execution,
    ...overrides.execution,
    stage: 'brain'
  }
})

export const returnToBrainAfterTraceState = (input: {
  state: HumanState
  traceItems: HumanTraceItemInput[]
  watchHint?: HumanWatchHint
  overrides?: HumanStateOverrides<'trace'>
}): HumanState => {
  const traceSteps = appendHumanTraceSteps({
    steps: input.state.trace.steps,
    items: input.traceItems
  })

  return returnToBrainState(input.state, {
    ...input.overrides,
    execution: {
      ...input.overrides?.execution,
      watchHint: input.watchHint
    },
    trace: {
      steps: traceSteps
    }
  })
}

export const resolveBrainDecisionWatchHint = (input: {
  decision: HumanDecision
  stableMemory: HumanStableMemory
  watchHint?: HumanWatchHint
}): HumanWatchHint | undefined => {
  if (input.watchHint) return input.watchHint
  if (input.decision.nextAction.action !== 'mouth') return undefined

  const pendingItems = input.stableMemory.checklist
    .filter((item) => item.status === 'todo')
    .map((item) => item.item)

  return pendingItems.length > 0
    ? {
        code: 'brain_checklist_incomplete',
        detail: {
          pendingItems
        }
      }
    : undefined
}

const resolveBrainNextStage = (input: {
  watchHint?: HumanWatchHint
  decision: HumanDecision
}): HumanState['execution']['stage'] => {
  if (input.watchHint) return 'brain'
  return input.decision.nextAction.action === 'learning'
    ? 'learning'
    : input.decision.nextAction.action === 'hand'
      ? 'hand'
      : 'mouth'
}

export const applyBrainDecisionState = (input: {
  state: HumanState
  decision: HumanDecision
  stableMemory: HumanStableMemory
  watchHint?: HumanWatchHint
  createdAt: number
}): HumanState => ({
  ...input.state,
  execution: {
    ...input.state.execution,
    stage: resolveBrainNextStage({
      watchHint: input.watchHint,
      decision: input.decision
    }),
    status: 'running',
    currentDecision: input.decision,
    watchHint: input.watchHint
  },
  memory: {
    stable: input.stableMemory,
    history: input.watchHint
      ? appendRoundRecord({
          state: input.state,
          decision: input.decision,
          execution: buildPreExecutionBlockedExecution(input.watchHint),
          createdAt: input.createdAt
        })
      : {
          ...input.state.memory.history,
          loadedHistoryContext: undefined
        }
  },
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
  artifacts: input.state.execution.artifacts.length > 0 ? [...input.state.execution.artifacts] : undefined
})

export const completeHumanTaskState = (input: {
  state: HumanState
  result: HumanResult
}): HumanState => ({
  ...input.state,
  execution: {
    ...input.state.execution,
    stage: 'mouth',
    status: 'completed'
  },
  memory: {
    ...input.state.memory,
    history: appendDecisionRound({
      state: input.state,
      execution: buildMouthExecution({
        summary: input.result.summary,
        completed: true
      })
    })
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
