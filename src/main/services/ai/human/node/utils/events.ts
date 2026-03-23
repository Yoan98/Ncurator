import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanTraceStep, RuntimeSkillId } from '../../types'

export const appendHumanTraceStep = (input: {
  steps: HumanTraceStep[]
  action: HumanTraceStep['action']
  publicNarrative: string
  resultStatus?: HumanTraceStep['resultStatus']
  skillId?: RuntimeSkillId
  toolName?: string
  summary: string
}): HumanTraceStep[] => {
  const step = input.steps.length + 1
  return [
    ...input.steps,
    {
      step,
      action: input.action,
      publicNarrative: input.publicNarrative,
      resultStatus: input.resultStatus,
      skillId: input.skillId,
      toolName: input.toolName,
      summary: input.summary
    }
  ]
}

export const appendHumanTraceSteps = (input: {
  steps: HumanTraceStep[]
  items: Array<{
    action: HumanTraceStep['action']
    publicNarrative: string
    resultStatus?: HumanTraceStep['resultStatus']
    skillId?: RuntimeSkillId
    toolName?: string
    summary: string
  }>
}): HumanTraceStep[] =>
  input.items.reduce(
    (steps, item) =>
      appendHumanTraceStep({
        steps,
        action: item.action,
        publicNarrative: item.publicNarrative,
        resultStatus: item.resultStatus,
        skillId: item.skillId,
        toolName: item.toolName,
        summary: item.summary
      }),
    input.steps
  )

export const emitHumanStep = (input: {
  ctx: AiRunContext
  taskId: string
  step: HumanTraceStep
  learnedSkillIds: RuntimeSkillId[]
  availableToolNames: string[]
  stage: 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'
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
      input.source === 'learning'
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
