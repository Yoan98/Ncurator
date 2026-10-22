import type { AiRunContext } from '../../../types'
import type {
  HumanRoundThought,
  HumanRuntimeCache,
  HumanState,
  HumanDispatchItem
} from '../../types'
import type { MarkdownLinkAccessEntry } from '../../../../../../shared/types'
import { emitLatestHumanStepForState, emitTailHumanStepsForState } from './stateTransitionEvents'
import {
  applyBrainDecisionState,
  buildHumanResult,
  completeHumanTaskState,
  returnToBrainAfterTraceState,
  returnToBrainState,
  type HumanStateOverrides,
  type HumanTraceItemInput
} from './stateTransitionState'
import { peekDispatchGroup } from '../dispatch'

export type { HumanTraceItemInput } from './stateTransitionState'

export const returnToBrain = (state: HumanState, overrides: HumanStateOverrides = {}): HumanState =>
  returnToBrainState(state, overrides)

export const returnToDispatch = (
  state: HumanState,
  overrides: HumanStateOverrides = {}
): HumanState =>
  returnToBrainState(state, {
    ...overrides,
    execution: {
      ...overrides.execution,
      stage: 'dispatch',
      pendingRound: undefined
    }
  })

export const returnToBrainAfterTrace = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  traceItems: HumanTraceItemInput[]
  stage: 'human_toolset_loading' | 'human_skill_loading' | 'human_hand'
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

export const applyBrainDispatchTransition = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  thought: HumanRoundThought
  dispatchQueue: HumanDispatchItem[]
}): HumanState => {
  const peeked = peekDispatchGroup(input.dispatchQueue)
  if (peeked.empty) {
    throw new Error('brain 交付不应通过空 dispatch 队列处理。')
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

  return nextState
}

export const completeHumanTask = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  deliveryMarkdown: string
  emitAnswerEvents: boolean
  linkAccess?: MarkdownLinkAccessEntry[]
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
      linkAccess: input.linkAccess || []
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
    stage: 'human_brain'
  })

  return nextState
}
