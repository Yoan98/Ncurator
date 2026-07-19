import type {
  HumanThoughtDecision,
  HumanResult,
  HumanThought,
  HumanState,
  HumanTraceStep,
  HumanDecisionHint
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
  decisionHint?: HumanDecisionHint
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
      pendingDecisionHint: input.decisionHint
    },
    trace: {
      steps: traceSteps
    }
  })
}

const resolveBrainNextStage = (input: {
  thought: HumanThoughtDecision
}): HumanState['execution']['stage'] => {
  return input.thought.nextAction.action === 'learning'
    ? 'learning'
    : input.thought.nextAction.action === 'hand'
      ? 'hand'
      : input.thought.nextAction.action === 'mouth'
        ? 'mouth'
        : 'fault'
}

export const applyBrainDecisionState = (input: {
  state: HumanState
  thought: HumanThoughtDecision
  thoughtMemory: HumanThought
  createdAt: number
  overrides?: HumanStateOverrides
}): HumanState => {
  return {
    ...input.state,
    ...input.overrides,
    execution: {
      ...input.state.execution,
      ...input.overrides?.execution,
      stage: resolveBrainNextStage({
        thought: input.thought
      }),
      status: 'running',
      finalizationReason: undefined,
      currentThought: input.thought,
      pendingDecisionHint: undefined,
      pendingFault:
        input.thought.nextAction.action === 'learning' ||
        input.thought.nextAction.action === 'hand' ||
        input.thought.nextAction.action === 'mouth'
          ? undefined
          : {
              result: `决策失败，无法识别 \`nextAction.action\` 的值 \`${input.thought.nextAction.action}\`。`
            },
      evidenceReferences: undefined
    },
    memory: {
      ...input.state.memory,
      thought: input.thoughtMemory,
      taskRun: {
        ...input.state.memory.taskRun
      }
    },
    trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        item: {
          action: 'brain_decision',
          publicNarrative: input.thought.thought.next,
          resultStatus: 'ok',
          summary: input.thought.thought.next
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
    stage: 'mouth',
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
