import type {
  DiagnosticTrace,
  HumanStepAction,
  HumanStepRecord,
  HumanStepResultStatus,
  RuntimeSkillId
} from '../../../../../shared/types'
import type { AiRunContext } from '../../types'

export const appendHumanStepRecord = (input: {
  history: HumanStepRecord[]
  step: number
  action: HumanStepAction
  publicNarrative: string
  activeSkillIds: RuntimeSkillId[]
  activeToolNames: string[]
  resultStatus?: HumanStepResultStatus
  skillId?: RuntimeSkillId
  toolName?: string
  summary?: string
}): HumanStepRecord[] => {
  return [
    ...input.history,
    {
      step: input.step,
      action: input.action,
      publicNarrative: input.publicNarrative,
      activeSkillIds: [...input.activeSkillIds],
      activeToolNames: [...input.activeToolNames],
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
  stage: 'human_brain' | 'human_skill_loader' | 'human_tool_exec'
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

export const emitHumanDiagnostic = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
  stepIndex: number
  action: HumanStepAction
  trace: DiagnosticTrace
  stage: 'human_brain' | 'human_skill_loader' | 'human_tool_exec'
}) => {
  input.ctx.sendEvent({
    type: 'human_diagnostic',
    runId: input.runId,
    taskId: input.taskId,
    stepIndex: input.stepIndex,
    action: input.action,
    trace: input.trace,
    createdAt: Date.now(),
    internal: true,
    stage: input.stage
  })
}
