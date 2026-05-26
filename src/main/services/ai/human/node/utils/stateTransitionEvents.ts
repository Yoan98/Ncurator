import type { AiRunContext } from '../../../types'
import type { DecisionHintSource } from '../../../../../../shared/types'
import type {
  HumanRuntimeCache,
  HumanState,
  HumanTraceStep,
  HumanDecisionHint,
  RuntimeSkillId
} from '../../types'
import { renderDecisionHintDetail, renderDecisionHintForBrain } from '../../prompts/decisionHints'
import { getEffectiveLearnedSkillIds } from '../../skills'
import { getAvailableToolNames } from './runtimeCache'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'

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
  cache: HumanRuntimeCache
  state: HumanState
}) => ({
  learnedSkillIds: input.state.skills.learnedSkillIds,
  effectiveSkillIds: getEffectiveLearnedSkillIds(input.state.skills.learnedSkillIds),
  availableToolNames: getAvailableToolNames({
    learnedSkillIds: input.state.skills.learnedSkillIds
  })
})

export const emitDecisionHint = (input: {
  ctx: AiRunContext
  taskId?: string
  source: DecisionHintSource
  decisionHint: HumanDecisionHint
}) => {
  input.ctx.sendEvent({
    type: 'decision_hint',
    runId: input.ctx.runId,
    taskId: input.taskId,
    source: input.source,
    code: input.decisionHint.code,
    detail: renderDecisionHintDetail(input.decisionHint),
    summary: renderDecisionHintForBrain(input.decisionHint),
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
