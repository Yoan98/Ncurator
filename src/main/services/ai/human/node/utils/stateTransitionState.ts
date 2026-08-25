import type {
  HumanNextAction,
  HumanResult,
  HumanRoundThought,
  HumanState,
  HumanTraceStep
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
): HumanState => {
  const targetStage = overrides.execution?.stage ?? 'brain'
  return {
    ...state,
    ...overrides,
    execution: {
      ...state.execution,
      ...overrides.execution,
      stage: targetStage
    }
  }
}

export const returnToBrainAfterTraceState = (input: {
  state: HumanState
  traceItems: HumanTraceItemInput[]
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
      stage: 'dispatch'
    },
    trace: {
      steps: traceSteps
    }
  })
}

const resolveBrainNextStage = (action: HumanNextAction['action']): HumanState['execution']['stage'] =>
  action === 'learning' ? 'learning' : action === 'hand' ? 'hand' : 'plan'

export const applyBrainDecisionState = (input: {
  state: HumanState
  thought: HumanRoundThought
  nextAction: HumanNextAction
  createdAt: number
  overrides?: HumanStateOverrides
}): HumanState => {
  return {
    ...input.state,
    ...input.overrides,
    execution: {
      ...input.state.execution,
      ...input.overrides?.execution,
      stage: resolveBrainNextStage(input.nextAction.action),
      status: 'running',
      finalizationReason: undefined,
      pendingRound: {
        thought: input.thought,
        nextAction: input.nextAction
      },
      evidenceReferences: undefined
    },
    trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        item: {
          action: 'brain_decision',
          publicNarrative: input.thought.text,
          resultStatus: 'ok',
          summary: input.thought.text
        }
      })
    }
  }
}

export const buildHumanResult = (input: {
  state: HumanState
  deliveryMarkdown: string
}): HumanResult => ({
  status: 'completed',
  deliveryMarkdown: input.deliveryMarkdown,
  artifacts:
    input.state.execution.artifacts.length > 0 ? [...input.state.execution.artifacts] : undefined
})

export const completeHumanTaskState = (input: {
  state: HumanState
  result: HumanResult
}): HumanState => ({
  ...input.state,
  execution: {
    ...input.state.execution,
    stage: 'brain',
    status: 'completed'
  },
  result: input.result,
  trace: {
    steps: appendHumanTraceStep({
      steps: input.state.trace.steps,
      item: {
        action: 'deliver_result',
        publicNarrative: input.result.deliveryMarkdown,
        resultStatus: 'ok',
        summary: '已完成最终交付'
      }
    })
  }
})
