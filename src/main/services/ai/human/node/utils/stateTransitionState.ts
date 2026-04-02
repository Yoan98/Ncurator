import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type {
  HumanResult,
  HumanState,
  HumanTraceStep,
  LastBrainDecision
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
  Omit<HumanState, 'runtime' | TExcluded>
> & {
  runtime?: Partial<HumanState['runtime']>
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
  overrides?: HumanStateOverrides<'watchHint' | 'trace'>
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

const combineWatchHints = (hints: Array<string | undefined>): string | undefined => {
  const normalized = hints.map((hint) => String(hint || '').trim()).filter(Boolean)
  if (normalized.length === 0) return undefined
  return Array.from(new Set(normalized)).join('\n')
}

export const resolveBrainDecisionWatchHint = (input: {
  decision: LastBrainDecision
  watchHint?: string
}): string | undefined => {
  const decisionWatchHint =
    input.decision.nextAction.action === 'mouth' && !input.decision.readyToDeliver
      ? 'brain 选择 mouth 时必须 readyToDeliver=true；当前结果仍未准备好收尾，请继续判断下一步。'
      : undefined

  return combineWatchHints([input.watchHint, decisionWatchHint])
}

const resolveBrainNextStage = (input: {
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
  createdAt: number
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
          createdAt: input.createdAt
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
