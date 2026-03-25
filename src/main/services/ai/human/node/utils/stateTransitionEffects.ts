import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { emitHumanStep, emitTaskDelivery, emitWatchHint } from './events'
import { getAvailableToolNames } from './runtimeCache'

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

export const emitWatchHintEffect = (input: {
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

export const emitAnswerCompletedEffect = (input: {
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

export const emitTaskDeliveryEffect = (input: {
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
