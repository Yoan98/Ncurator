import type { AiRunContext } from '../../../types'
import type {
  HumanNextAction,
  HumanRoundThought,
  HumanRuntimeCache,
  HumanState,
  HumanDispatchItem
} from '../../types'
import {
  emitLatestHumanStepForState,
  emitTailHumanStepsForState
} from './stateTransitionEvents'
import {
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  returnToBrainAfterTraceState,
  returnToBrainState,
  type HumanStateOverrides,
  type HumanTraceItemInput
} from './stateTransitionState'
import { emitAssistantProcessThought } from '../../../events/processEvents'
import { peekDispatchGroup } from '../dispatch'

export type { HumanTraceItemInput } from './stateTransitionState'

export { appendHumanTraceStep } from './stateTransitionState'

export const returnToBrain = (
  state: HumanState,
  overrides: HumanStateOverrides = {}
): HumanState => returnToBrainState(state, overrides)

export const returnToBrainAfterTrace = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  traceItems: HumanTraceItemInput[]
  stage: 'human_learning' | 'human_hand'
  overrides?: HumanStateOverrides<'trace'>
}): HumanState => {
  const nextState = returnToBrainAfterTraceState({
    state: input.state,
    traceItems: input.traceItems,
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
  thought: HumanRoundThought
  nextAction: HumanNextAction
  overrides?: HumanStateOverrides
}): HumanState => {
  const nextState = applyBrainDecisionState({
    state: input.state,
    thought: input.thought,
    nextAction: input.nextAction,
    createdAt: Date.now(),
    overrides: input.overrides
  })

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_brain'
  })
  emitAssistantProcessThought({
    sendEvent: input.ctx.sendEvent,
    runId: input.ctx.runId,
    text: input.thought.text
  })

  return nextState
}

export const applyBrainDispatchTransition = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  thought: HumanRoundThought
  dispatchQueue: HumanDispatchItem[]
}): HumanState => {
  const peeked = peekDispatchGroup(input.dispatchQueue)
  if (peeked.empty) {
    return applyBrainDecisionTransition({
      ctx: input.ctx,
      cache: input.cache,
      state: input.state,
      thought: input.thought,
      nextAction: { action: 'mouth' }
    })
  }

  const base = applyBrainDecisionState({
    state: input.state,
    thought: input.thought,
    nextAction: peeked.nextAction,
    createdAt: Date.now()
  })
  const nextState: HumanState = {
    ...base,
    execution: {
      ...base.execution,
      stage: 'dispatch',
      pendingDispatch: input.dispatchQueue
    }
  }

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_brain'
  })
  emitAssistantProcessThought({
    sendEvent: input.ctx.sendEvent,
    runId: input.ctx.runId,
    text: input.thought.text
  })

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
