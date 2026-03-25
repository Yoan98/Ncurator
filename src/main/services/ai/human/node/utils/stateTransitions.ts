import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type {
  HumanResult,
  HumanRuntimeCache,
  HumanState,
  HumanTraceStep,
  LastBrainDecision,
  RuntimeSkillId
} from '../../types'
import { getAvailableToolNames } from './runtimeCache'
import { emitHumanStep, emitTaskDelivery, emitWatchHint } from './events'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'
export type HumanTraceItemInput = {
  action: HumanTraceStep['action']
  publicNarrative: string
  resultStatus?: HumanTraceStep['resultStatus']
  skillId?: RuntimeSkillId
  toolName?: string
  summary: string
}

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

const returnToBrainState = (
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

const returnToBrainAfterTraceState = (input: {
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

const applyBrainDecisionState = (input: {
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

const buildHumanResult = (input: {
  state: HumanState
  summary: string
  deliveryMarkdown: string
}): HumanResult => ({
  status: 'completed',
  summary: input.summary,
  deliveryMarkdown: input.deliveryMarkdown,
  artifacts: input.state.runtimeArtifacts.length > 0 ? [...input.state.runtimeArtifacts] : undefined
})

const completeHumanTaskState = (input: {
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

const buildStepToolContext = (input: {
  cache: HumanRuntimeCache
  state: HumanState
}) => ({
  learnedSkillIds: input.state.brainMemory.outside.learnedSkillIds,
  availableToolNames: getAvailableToolNames({
    learnedSkillIds: input.state.brainMemory.outside.learnedSkillIds,
    cache: input.cache
  })
})

const emitWatchHintEffect = (input: {
  ctx: AiRunContext
  taskId?: string
  source: WatchHintSource
  summary: string
}) => {
  emitWatchHint({
    ctx: input.ctx,
    taskId: input.taskId,
    source: input.source,
    summary: input.summary
  })
}

export const emitLatestHumanStepForState = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  state: HumanState
  stage: HumanEventStage
}) => {
  const step = input.state.trace.steps.at(-1)
  if (!step) return

  const toolContext = buildStepToolContext({
    cache: input.cache,
    state: input.state
  })
  emitHumanStep({
    ctx: input.ctx,
    taskId: input.taskId,
    step,
    learnedSkillIds: toolContext.learnedSkillIds,
    availableToolNames: toolContext.availableToolNames,
    stage: input.stage
  })
}

export const emitTailHumanStepsForState = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  state: HumanState
  count: number
  stage: HumanEventStage
}) => {
  if (input.count <= 0) return
  const toolContext = buildStepToolContext({
    cache: input.cache,
    state: input.state
  })
  input.state.trace.steps.slice(-input.count).forEach((step) => {
    emitHumanStep({
      ctx: input.ctx,
      taskId: input.taskId,
      step,
      learnedSkillIds: toolContext.learnedSkillIds,
      availableToolNames: toolContext.availableToolNames,
      stage: input.stage
    })
  })
}

const emitAnswerCompletedEffect = (input: {
  ctx: AiRunContext
  taskId: string
  deliveryMarkdown: string
}) => {
  input.ctx.sendEvent({
    type: 'answer_completed',
    runId: input.ctx.runId,
    taskId: input.taskId,
    text: input.deliveryMarkdown,
    stage: 'human_mouth'
  })
}

const emitTaskDeliveryEffect = (input: {
  ctx: AiRunContext
  taskId: string
  summary: string
  deliveryMarkdown: string
  internal?: boolean
}) => {
  emitTaskDelivery({
    ctx: input.ctx,
    taskId: input.taskId,
    summary: input.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    internal: input.internal
  })
}

export const returnToBrain = (
  state: HumanState,
  overrides: Partial<Omit<HumanState, 'runtime'>> & {
    runtime?: Partial<HumanState['runtime']>
  } = {}
): HumanState => returnToBrainState(state, overrides)

export const returnToBrainWithWatchHint = (input: {
  ctx: AiRunContext
  state: HumanState
  source: WatchHintSource
  watchHint: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  emitWatchHintEffect({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    source: input.source,
    summary: input.watchHint
  })
  return returnToBrainState(input.state, {
    ...input.overrides,
    watchHint: input.watchHint
  })
}

export const returnToBrainAfterTrace = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  source: WatchHintSource
  traceItems: HumanTraceItemInput[]
  stage: 'human_learning' | 'human_hand'
  watchHint?: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint' | 'trace'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  const nextState = returnToBrainAfterTraceState({
    state: input.state,
    traceItems: input.traceItems,
    watchHint: input.watchHint,
    overrides: input.overrides
  })

  if (input.watchHint) {
    emitWatchHintEffect({
      ctx: input.ctx,
      taskId: input.state.task.taskId,
      source: input.source,
      summary: input.watchHint
    })
  }

  emitTailHumanStepsForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    count: input.traceItems.length,
    stage: input.stage
  })
  return nextState
}

export const applyBrainDecisionTransition = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  decision: LastBrainDecision
  reducedInside: HumanState['brainMemory']['inside']
  watchHint?: string
}): HumanState => {
  const nextState = applyBrainDecisionState({
    state: input.state,
    decision: input.decision,
    reducedInside: input.reducedInside,
    watchHint: input.watchHint,
    createdAt: Date.now()
  })

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_brain'
  })

  if (input.watchHint) {
    emitWatchHintEffect({
      ctx: input.ctx,
      taskId: input.state.task.taskId,
      source: 'memory_reducer',
      summary: input.watchHint
    })
  }

  return nextState
}

export const completeHumanTask = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  summary: string
  deliveryMarkdown: string
  streamAnswer: boolean
  internalDelivery: boolean
}): HumanState => {
  const finalResult = buildHumanResult({
    state: input.state,
    summary: input.summary,
    deliveryMarkdown: input.deliveryMarkdown
  })

  if (input.streamAnswer) {
    emitAnswerCompletedEffect({
      ctx: input.ctx,
      taskId: input.state.task.taskId,
      deliveryMarkdown: input.deliveryMarkdown
    })
  }

  emitTaskDeliveryEffect({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    summary: finalResult.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    internal: input.internalDelivery
  })

  const nextState = completeHumanTaskState({
    state: input.state,
    result: finalResult
  })

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_mouth'
  })

  return nextState
}
