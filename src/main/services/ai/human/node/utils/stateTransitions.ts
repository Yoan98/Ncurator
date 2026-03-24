import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, LastBrainDecision } from '../../types'
import {
  emitAnswerCompletedEffect,
  emitLatestHumanStepForState,
  emitTailHumanStepsForState,
  emitTaskDeliveryEffect,
  emitWatchHintEffect
} from './effects'
import type { HumanEventStage } from './effects'
import {
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  returnToBrainAfterTraceState,
  returnToBrainState
} from './reducers'
import type { HumanTraceItemInput } from './trace'

export type { HumanEventStage }

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

export { emitLatestHumanStepForState, emitTailHumanStepsForState }

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
  const nextState = input.watchHint
    ? returnToBrainWithWatchHint({
        ctx: input.ctx,
        state: input.state,
        source: input.source,
        watchHint: input.watchHint,
        overrides: {
          ...input.overrides,
          trace: {
            steps: returnToBrainAfterTraceState({
              state: input.state,
              traceItems: input.traceItems
            }).trace.steps
          }
        }
      })
    : returnToBrainAfterTraceState({
        state: input.state,
        traceItems: input.traceItems,
        watchHint: undefined,
        overrides: input.overrides
      })

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
    watchHint: input.watchHint
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
