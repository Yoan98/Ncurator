import type { AiRunContext } from '../../../types'
import type { WatchHintSource } from '../../../../../../shared/types'
import type { HumanRuntimeCache, HumanState, LastBrainDecision } from '../../types'
import {
  emitLatestHumanStepForState,
  emitTailHumanStepsForState,
  emitTaskDelivery,
  emitWatchHint
} from './stateTransitionEvents'
import {
  appendHumanTraceStep,
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  returnToBrainAfterTraceState,
  returnToBrainState,
  type HumanStateOverrides,
  type HumanTraceItemInput
} from './stateTransitionState'

export type { HumanTraceItemInput } from './stateTransitionState'

export { appendHumanTraceStep } from './stateTransitionState'

export const returnToBrain = (
  state: HumanState,
  overrides: HumanStateOverrides = {}
): HumanState => returnToBrainState(state, overrides)

export const returnToBrainWithWatchHint = (input: {
  ctx: AiRunContext
  state: HumanState
  source: WatchHintSource
  watchHint: string
  overrides?: HumanStateOverrides<'watchHint'>
}): HumanState => {
  emitWatchHint({
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
  overrides?: HumanStateOverrides<'watchHint' | 'trace'>
}): HumanState => {
  const nextState = returnToBrainAfterTraceState({
    state: input.state,
    traceItems: input.traceItems,
    watchHint: input.watchHint,
    overrides: input.overrides
  })

  if (input.watchHint) {
    emitWatchHint({
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
    emitWatchHint({
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
    input.ctx.sendEvent({
      type: 'answer_completed',
      runId: input.ctx.runId,
      taskId: input.state.task.taskId,
      text: input.deliveryMarkdown,
      stage: 'human_mouth'
    })
  }

  emitTaskDelivery({
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
