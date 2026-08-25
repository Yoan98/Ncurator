import type { AiRunContext } from '../../../types'
import type {
  HumanRuntimeCache,
  HumanState,
  HumanTraceStep,
  RuntimeSkillId
} from '../../types'
import { getEffectiveLearnedSkillIds } from '../../skills'
import { getAvailableToolNames } from './runtimeCache'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand'

const emitHumanStep = (input: {
  ctx: AiRunContext
  taskId: string
  step: HumanTraceStep
  learnedSkillIds: RuntimeSkillId[]
  effectiveSkillIds: RuntimeSkillId[]
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
    effectiveSkillIds: [...input.effectiveSkillIds],
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
  learnedSkillIds: input.state.skills.learnedSkillIds,
  effectiveSkillIds: getEffectiveLearnedSkillIds(input.state.skills.learnedSkillIds),
  availableToolNames: getAvailableToolNames({
    learnedSkillIds: input.state.skills.learnedSkillIds
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
    learnedSkillIds: toolContext.learnedSkillIds,
    effectiveSkillIds: toolContext.effectiveSkillIds,
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
      learnedSkillIds: toolContext.learnedSkillIds,
      effectiveSkillIds: toolContext.effectiveSkillIds,
      availableToolNames: toolContext.availableToolNames,
      stage: input.stage
    })
  })
}
