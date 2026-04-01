import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  AiToolCallResult,
  IpcJsonObject,
  IpcJsonValue
} from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { TERMINAL_RUN_COMMAND_TOOL_SPEC } from './toolSpecs'
import { runTerminalCommand } from './terminalExec'
import type {
  TerminalCapabilityToolsInput,
  TerminalCapabilityToolsRuntimeState,
  TerminalCommandApprovalRiskLevel
} from './types'
import { clipText, clipTextWithMeta } from '../../../utils/text'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import { analyzeTerminalCommand, checkWorkspaceBoundary } from './terminalCommandPolicy'
import { resolveTerminalCwd } from './terminalCwd'
const buildTerminalStepError = (input: {
  exitCode: number | null
  timedOut: boolean
  timeoutMs: number
}): string | undefined =>
  input.timedOut
    ? `command timed out after ${input.timeoutMs}ms`
    : input.exitCode !== 0
      ? `command exited with code ${String(input.exitCode)}`
      : undefined

const emitTerminalStepStarted = (input: {
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

const emitTerminalStepCompletion = (input: {
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

const buildTerminalFailure = <TCode extends AiTaskResultCode>(input: {
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

const buildTerminalToolResult = (input: {
  toolName: string
  ok: boolean
  code: AiTaskResultCode
  data: AiToolCallResult['data']
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  code: input.code,
  data: input.data,
  diagnostic:
    input.code === 'workspace_required'
      ? { kind: 'workspace_required' }
      : input.code === 'approval_denied'
        ? { kind: 'approval_denied' }
        : input.code === 'invalid_input'
          ? { kind: 'invalid_input' }
          : undefined
})

const requestTerminalCommandApproval = async (input: {
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

export const buildTerminalCapabilityTools = (input: TerminalCapabilityToolsInput) => {
  const state: TerminalCapabilityToolsRuntimeState = {
    stepIndex: 0
  }
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })

  const terminalRunCommand = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: 'terminal_run_command',
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          if (!command) {
            const emptyResult = buildTerminalFailure({
              code: 'invalid_input',
              error: 'empty command'
            })
            session.fail(
              emptyResult,
              emptyResult.error,
              undefined,
              buildTerminalToolResult({
                toolName: 'terminal_run_command',
                ok: false,
                code: emptyResult.code,
                data: emptyResult
              })
            )
            return emptyResult
          }

          const cwdResult = resolveTerminalCwd({
            workspaceRootPath: input.workspaceRootPath,
            requestedCwd: args.cwd
          })
          if (!cwdResult.ok) {
            const cwdError = buildTerminalFailure({
              code: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(
              cwdError,
              cwdError.error,
              undefined,
              buildTerminalToolResult({
                toolName: 'terminal_run_command',
                ok: false,
                code: cwdError.code,
                data: cwdError
              })
            )
            return cwdError
          }
          const cwd = cwdResult.cwd

          const boundary = checkWorkspaceBoundary(command, input.workspaceRootPath)
          if (!boundary.ok) {
            const boundaryError = buildTerminalFailure({
              code: 'workspace_required',
              error: `workspace boundary check failed: ${boundary.reason}`
            })
            session.fail(
              boundaryError,
              boundaryError.error,
              undefined,
              buildTerminalToolResult({
                toolName: 'terminal_run_command',
                ok: false,
                code: boundaryError.code,
                data: boundaryError
              })
            )
            return boundaryError
          }

          const analysis = analyzeTerminalCommand({
            command,
            cwd: args.cwd
          })
          const riskLevel = analysis.riskLevel
          if (riskLevel !== 'low') {
            const approval = await requestTerminalCommandApproval({
              ctx: input.ctx,
              runId: input.runId,
              taskId: input.taskId,
              command,
              riskLevel
            })
            if (!approval.approved) {
              const denied = buildTerminalFailure({
                code: 'approval_denied',
                error: approval.error
              })
              session.fail(
                denied,
                denied.error,
                undefined,
                buildTerminalToolResult({
                  toolName: 'terminal_run_command',
                  ok: false,
                  code: denied.code,
                  data: denied
                })
              )
              return denied
            }
          }

          const artifactCandidates = mergeArtifactCandidates({
            commandCandidates: analysis.artifactCandidates,
            expectedArtifacts: Array.isArray(args.expectedArtifacts) ? args.expectedArtifacts : [],
            cwd,
            workspaceRootPath: input.workspaceRootPath
          })

          state.stepIndex += 1
          const stepId = randomUUID()
          emitTerminalStepStarted({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            stepIndex: state.stepIndex,
            command,
            cwd
          })
          input.emitActivity({
            actionType: 'terminal_exec',
            status: 'started',
            summary: `执行命令: ${command}`
          })

          const result = await runTerminalCommand({
            command,
            cwd,
            timeoutMs: input.timeoutMs,
            maxOutputChars: input.maxOutputChars
          })

          const previewSource = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
          const preview = clipTextWithMeta(previewSource || '(no output)', input.safePreviewChars)
          const stepError = buildTerminalStepError({
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            timeoutMs: input.timeoutMs
          })
          emitTerminalStepCompletion({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            stepIndex: state.stepIndex,
            command,
            outputPreview: preview.text,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated || preview.truncated,
            stepError,
            emitActivity: input.emitActivity
          })

          const artifacts = recordTerminalArtifacts({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            candidates: artifactCandidates,
            emitActivity: input.emitActivity
          })

          const output = {
            ok: !stepError,
            code: stepError ? ('failed' as const) : ('ok' as const),
            command,
            cwd,
            stepId,
            stepIndex: state.stepIndex,
            outputPreview: preview.text,
            stdoutPreview: clipText(result.stdout, input.safePreviewChars),
            stderrPreview: clipText(result.stderr, input.safePreviewChars),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated || preview.truncated,
            artifacts,
            ...(stepError ? { error: stepError } : {})
          }
          if (stepError) {
            session.fail(
              output as IpcJsonValue,
              stepError,
              undefined,
              buildTerminalToolResult({
                toolName: 'terminal_run_command',
                ok: false,
                code: 'failed',
                data: output as AiToolCallResult['data']
              })
            )
          } else {
            session.succeed(
              output as IpcJsonValue,
              undefined,
              buildTerminalToolResult({
                toolName: 'terminal_run_command',
                ok: true,
                code: 'ok',
                data: output as AiToolCallResult['data']
              })
            )
          }
          return output
        },
        onError: (error, session) => {
          const failure = { ok: false, code: 'failed', error: error.message } as const
          session.fail(
            failure as IpcJsonValue,
            error.message,
            undefined,
            buildTerminalToolResult({
              toolName: 'terminal_run_command',
              ok: false,
              code: 'failed',
              data: failure
            })
          )
        }
      }),
    {
      name: TERMINAL_RUN_COMMAND_TOOL_SPEC.name,
      description:
        'Execute one shell command inside workspace with boundary checks, risk classification, approval gating, and terminal-step events.',
      schema: TERMINAL_RUN_COMMAND_TOOL_SPEC.schema
    }
  )

  return {
    tools: [terminalRunCommand],
    state
  }
}
