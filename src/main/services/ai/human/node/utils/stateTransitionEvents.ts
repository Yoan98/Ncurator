import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, HumanTraceStep, RuntimeToolsetId } from '../../types'
import { getEffectiveLoadedToolsetIds } from '../../toolsets'
import { getAvailableToolNames } from './runtimeCache'

export type HumanEventStage =
  | 'human_brain'
  | 'human_toolset_loading'
  | 'human_skill_loading'
  | 'human_hand'

const emitHumanStep = (input: {
  ctx: AiRunContext
  taskId: string
  step: HumanTraceStep
  loadedToolsetIds: RuntimeToolsetId[]
  effectiveToolsetIds: RuntimeToolsetId[]
  availableToolNames: string[]
  stage: HumanEventStage
}) => {
  input.ctx.sendEvent({
    type: 'human_step',
    runId: input.ctx.runId,
    taskId: input.taskId,
    stepIndex: input.step.step,
    action: input.step.action,
    toolsetId: input.step.toolsetId,
    toolName: input.step.toolName,
    publicNarrative: input.step.publicNarrative,
    loadedToolsetIds: [...input.loadedToolsetIds],
    effectiveToolsetIds: [...input.effectiveToolsetIds],
    availableToolNames: [...input.availableToolNames],
    resultStatus: input.step.resultStatus,
    summary: input.step.summary,
    createdAt: Date.now(),
    stage: input.stage
  })
}

const buildStepToolContext = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
}) => ({
  loadedToolsetIds: input.state.toolsets.loadedToolsetIds,
  effectiveToolsetIds: getEffectiveLoadedToolsetIds(input.state.toolsets.loadedToolsetIds),
  availableToolNames: getAvailableToolNames({
    loadedToolsetIds: input.state.toolsets.loadedToolsetIds
  })
})

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
    ctx: input.ctx,
    cache: input.cache,
    state: input.state
  })
  emitHumanStep({
    ctx: input.ctx,
    taskId: input.taskId,
    step,
    loadedToolsetIds: toolContext.loadedToolsetIds,
    effectiveToolsetIds: toolContext.effectiveToolsetIds,
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
    ctx: input.ctx,
    cache: input.cache,
    state: input.state
  })
  input.state.trace.steps.slice(-input.count).forEach((step) => {
    emitHumanStep({
      ctx: input.ctx,
      taskId: input.taskId,
      step,
      loadedToolsetIds: toolContext.loadedToolsetIds,
      effectiveToolsetIds: toolContext.effectiveToolsetIds,
      availableToolNames: toolContext.availableToolNames,
      stage: input.stage
    })
  })
}
