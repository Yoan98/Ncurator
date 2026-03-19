import type {
  HumanStepAction,
  HumanStepResultStatus,
  HumanTraceStep,
  RuntimeSkillId,
  WatchdogSignalLevel
} from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'

export const appendHumanTraceStep = (input: {
  steps: HumanTraceStep[]
  step: number
  action: HumanStepAction
  publicNarrative: string
  resultStatus?: HumanStepResultStatus
  skillId?: RuntimeSkillId
  toolName?: string
  summary: string
}): HumanTraceStep[] => {
  return [
    ...input.steps,
    {
      step: input.step,
      action: input.action,
      publicNarrative: input.publicNarrative,
      resultStatus: input.resultStatus,
      skillId: input.skillId,
      toolName: input.toolName,
      summary: input.summary
    }
  ]
}

export const emitHumanStep = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
  stepIndex: number
  action: HumanStepAction
  publicNarrative: string
  activeSkillIds: RuntimeSkillId[]
  activeToolNames: string[]
  summary: string
  resultStatus?: HumanStepResultStatus
  skillId?: RuntimeSkillId
  toolName?: string
  stage: 'human_reason' | 'human_execute' | 'human_finalize'
}) => {
  input.ctx.sendEvent({
    type: 'human_step',
    runId: input.runId,
    taskId: input.taskId,
    stepIndex: input.stepIndex,
    action: input.action,
    skillId: input.skillId,
    toolName: input.toolName,
    publicNarrative: input.publicNarrative,
    activeSkillIds: [...input.activeSkillIds],
    activeToolNames: [...input.activeToolNames],
    resultStatus: input.resultStatus,
    summary: input.summary,
    createdAt: Date.now(),
    stage: input.stage
  })
}

export const emitTaskDelivery = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
  summary: string
  deliveryMarkdown: string
  internal?: boolean
}) => {
  input.ctx.sendEvent({
    type: 'task_delivery_ready',
    runId: input.runId,
    taskId: input.taskId,
    summary: input.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    createdAt: Date.now(),
    internal: input.internal,
    stage: 'human_finalize'
  })
}

export const emitWatchdogSignal = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  level: WatchdogSignalLevel
  summary: string
  signs: string[]
}) => {
  input.ctx.sendEvent({
    type: 'watchdog_signal',
    runId: input.runId,
    taskId: input.taskId,
    level: input.level,
    summary: input.summary,
    signs: [...input.signs],
    createdAt: Date.now(),
    stage: 'human_reason'
  })
}
