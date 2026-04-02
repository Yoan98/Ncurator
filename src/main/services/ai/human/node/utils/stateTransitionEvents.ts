import type { AiRunContext } from '../../../types'
import type { WatchHintSource } from '../../../../../../shared/types'
import type { HumanRuntimeCache, HumanState, HumanTraceStep, RuntimeSkillId } from '../../types'
import { getAvailableToolNames } from './runtimeCache'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'

const emitHumanStep = (input: {
  ctx: AiRunContext
  taskId: string
  step: HumanTraceStep
  learnedSkillIds: RuntimeSkillId[]
  availableToolNames: string[]
  stage: HumanEventStage
}) => {
  input.ctx.sendEvent({
    type: 'human_step',
    runId: input.ctx.runId,
    taskId: input.taskId,
    stepIndex: input.step.step,
    action: input.step.action,
    skillId: input.step.skillId,
    toolName: input.step.toolName,
    publicNarrative: input.step.publicNarrative,
    learnedSkillIds: [...input.learnedSkillIds],
    availableToolNames: [...input.availableToolNames],
    resultStatus: input.step.resultStatus,
    summary: input.step.summary,
    createdAt: Date.now(),
    stage: input.stage
  })
}

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

export const emitWatchHint = (input: {
  ctx: AiRunContext
  taskId?: string
  source: WatchHintSource
  summary: string
}) => {
  input.ctx.sendEvent({
    type: 'watch_hint',
    runId: input.ctx.runId,
    taskId: input.taskId,
    source: input.source,
    summary: input.summary,
    createdAt: Date.now(),
    stage:
      input.source === 'brain'
        ? 'human_brain'
        : input.source === 'learning'
        ? 'human_learning'
        : input.source === 'hand'
          ? 'human_hand'
          : 'human_brain'
  })
}

export const emitTaskDelivery = (input: {
  ctx: AiRunContext
  taskId: string
  summary: string
  deliveryMarkdown: string
  internal?: boolean
}) => {
  input.ctx.sendEvent({
    type: 'task_delivery_ready',
    runId: input.ctx.runId,
    taskId: input.taskId,
    summary: input.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    createdAt: Date.now(),
    internal: input.internal,
    stage: 'human_mouth'
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
