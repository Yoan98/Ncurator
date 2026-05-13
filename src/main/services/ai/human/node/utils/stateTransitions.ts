import type { AiRunContext } from '../../../types'
import type { WatchHintSource } from '../../../../../../shared/types'
import type {
  HumanThoughtDecision,
  HumanRuntimeCache,
  HumanState,
  HumanThought,
  HumanWatchHint,
} from '../../types'
import {
  emitLatestHumanStepForState,
  emitTailHumanStepsForState,
  emitWatchHint
} from './stateTransitionEvents'
import {
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  resolveBrainDecisionWatchHint,
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
  watchHint: HumanWatchHint
  overrides?: HumanStateOverrides
}): HumanState => {
  emitWatchHint({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    source: input.source,
    watchHint: input.watchHint
  })
  return returnToBrainState(input.state, {
    ...input.overrides,
    execution: {
      ...input.overrides?.execution,
      watchHint: input.watchHint
    }
  })
}

export const returnToBrainAfterTrace = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  source: WatchHintSource
  traceItems: HumanTraceItemInput[]
  stage: 'human_learning' | 'human_hand'
  watchHint?: HumanWatchHint
  overrides?: HumanStateOverrides<'trace'>
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
      watchHint: input.watchHint
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
  thought: HumanThoughtDecision
  thoughtMemory: HumanThought
  watchHint?: HumanWatchHint
}): HumanState => {
  const watchHint = resolveBrainDecisionWatchHint({
    state: input.state,
    thought: input.thought,
    thoughtMemory: input.thoughtMemory,
    watchHint: input.watchHint
  })
  const nextState = applyBrainDecisionState({
    state: input.state,
    thought: input.thought,
    thoughtMemory: input.thoughtMemory,
    watchHint,
    createdAt: Date.now()
  })

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_brain'
  })

  if (watchHint) {
    emitWatchHint({
      ctx: input.ctx,
      taskId: input.state.task.taskId,
      source: 'brain',
      watchHint
    })
  }

  return nextState
}

export const completeHumanTask = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  deliveryMarkdown: string
  emitAnswerEvents: boolean
}): HumanState => {
  const finalResult = buildHumanResult({
    state: input.state,
    deliveryMarkdown: input.deliveryMarkdown
  })

  if (input.emitAnswerEvents) {
    input.ctx.sendEvent({
      type: 'answer_completed',
      runId: input.ctx.runId,
      taskId: input.state.task.taskId,
      text: input.deliveryMarkdown,
      stage: 'human_mouth'
    })
  }

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
