import type { AiTaskResultCode } from '../../../../../../shared/types'
import type { CapabilityActivityInput } from '../types'
import type { TerminalToolContext } from '../../../types'
import type { TerminalCommandApprovalRiskLevel } from './types'

export const buildTerminalStepError = (input: {
  exitCode: number | null
  timedOut: boolean
  timeoutMs: number
}): string | undefined =>
  input.timedOut
    ? `command timed out after ${input.timeoutMs}ms`
    : input.exitCode !== 0
      ? `command exited with code ${String(input.exitCode)}`
      : undefined

export const emitTerminalStepStarted = (input: {
  ctx: TerminalToolContext
  runId: string
  taskId: string
  stepId: string
  stepIndex: number
  command: string
  cwd: string
}): void => {
  input.ctx.sendEvent({
    type: 'terminal_step_started',
    runId: input.runId,
    taskId: input.taskId,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    command: input.command,
    cwd: input.cwd,
    createdAt: Date.now()
  })
}

export const emitTerminalStepCompletion = (input: {
  ctx: TerminalToolContext
  runId: string
  taskId: string
  stepId: string
  stepIndex: number
  command: string
  outputPreview: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  stepError?: string
  emitActivity: (activity: CapabilityActivityInput) => void
}): void => {
  if (input.stepError) {
    input.ctx.sendEvent({
      type: 'terminal_step_error',
      runId: input.runId,
      taskId: input.taskId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      command: input.command,
      error: input.stepError,
      outputPreview: input.outputPreview,
      completedAt: Date.now()
    })
    input.emitActivity({
      actionType: 'terminal_exec',
      status: 'failed',
      summary: `${input.command} -> ${input.stepError}`
    })
    return
  }

  input.ctx.sendEvent({
    type: 'terminal_step_result',
    runId: input.runId,
    taskId: input.taskId,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    command: input.command,
    outputPreview: input.outputPreview,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    truncated: input.truncated,
    completedAt: Date.now()
  })
  input.emitActivity({
    actionType: 'terminal_exec',
    status: 'completed',
    summary: `${input.command} -> success`
  })
}

export const buildTerminalFailure = <TCode extends AiTaskResultCode>(input: {
  code: TCode
  error: string
}): {
  ok: false
  code: TCode
  error: string
} => ({
  ok: false,
  code: input.code,
  error: input.error
})

export const requestTerminalCommandApproval = async (input: {
  ctx: TerminalToolContext
  runId: string
  taskId: string
  command: string
  riskLevel: Exclude<TerminalCommandApprovalRiskLevel, 'low'>
}): Promise<{ approved: true } | { approved: false; error: string }> => {
  const decision = await input.ctx.requestApproval({
    runId: input.runId,
    taskId: input.taskId,
    command: input.command,
    riskLevel: input.riskLevel,
    reason: `command classified as ${input.riskLevel} risk`
  })
  if (decision.approved) {
    return { approved: true }
  }
  return {
    approved: false,
    error: decision.reason || 'approval denied'
  }
}
