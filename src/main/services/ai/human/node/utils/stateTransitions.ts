import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type {
  HumanRuntimeCache,
  HumanState,
  LastBrainDecision
} from '../../types'
import { getAvailableToolNames } from './runtimeCache'
import { emitHumanStep, emitTaskDelivery, emitWatchHint } from './events'
import {
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  returnToBrainAfterTraceState,
  returnToBrainState
} from './stateTransitionState'
import type { HumanTraceItemInput } from './stateTransitionState'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'

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
