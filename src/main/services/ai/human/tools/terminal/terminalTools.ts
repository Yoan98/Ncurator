import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  AiToolCallResult,
  JsonObject,
  IpcJsonObject
} from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { clipTextWithMeta } from '../../../utils/text'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import { analyzeTerminalCommand, checkWorkspaceBoundary } from './terminalCommandPolicy'
import { resolveTerminalCwd } from './terminalCwd'
import { runTerminalCommand } from './terminalExec'
import type {
  TerminalCapabilityToolsInput,
  TerminalCapabilityToolsRuntimeState,
  TerminalCommandApprovalRiskLevel
} from './types'
import {
  TERMINAL_RUN_SCHEMA,
  TERMINAL_RUN_TOOL_SPEC
} from './toolSpecs'

const isJsonObjectRecord = (value: AiToolCallResult['data']): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
    input.ok || !isJsonObjectRecord(input.data)
      ? undefined
      : typeof input.data.error === 'string' && input.data.error.trim()
        ? { message: input.data.error.trim() }
        : undefined
})

const buildFailure = <TCode extends AiTaskResultCode>(input: { code: TCode; error: string }) => ({
  ok: false as const,
  code: input.code,
  error: input.error
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
  if (decision.approved) return { approved: true }
  return {
    approved: false,
    error: decision.reason || 'approval denied'
  }
}

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

export const buildTerminalCapabilityTools = (input: TerminalCapabilityToolsInput) => {
  const state: TerminalCapabilityToolsRuntimeState = {
    stepIndex: 0
  }
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })

  const terminalRun = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: TERMINAL_RUN_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          if (!command) {
            const emptyResult = buildFailure({
              code: 'invalid_input',
              error: 'empty command'
            })
            session.fail(
              emptyResult,
              emptyResult.error,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_RUN_TOOL_SPEC.name,
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
            const cwdError = buildFailure({
              code: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(
              cwdError,
              cwdError.error,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_RUN_TOOL_SPEC.name,
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
            const boundaryError = buildFailure({
              code: 'workspace_required',
              error: `workspace boundary check failed: ${boundary.reason}`
            })
            session.fail(
              boundaryError,
              boundaryError.error,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_RUN_TOOL_SPEC.name,
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
          if (analysis.riskLevel !== 'low') {
            const approval = await requestTerminalCommandApproval({
              ctx: input.ctx,
              runId: input.runId,
              taskId: input.taskId,
              command,
              riskLevel: analysis.riskLevel
            })
            if (!approval.approved) {
              const denied = buildFailure({
                code: 'approval_denied',
                error: approval.error
              })
              session.fail(
                denied,
                denied.error,
                undefined,
                buildTerminalToolResult({
                  toolName: TERMINAL_RUN_TOOL_SPEC.name,
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
            expectedArtifacts: [],
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

          const artifacts = await recordTerminalArtifacts({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            candidates: artifactCandidates,
            emitActivity: input.emitActivity
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
            truncated: preview.truncated || result.truncated,
            stepError,
            emitActivity: input.emitActivity
          })

          const payload = {
            ok: !stepError,
            code: (stepError ? 'failed' : 'ok') as 'failed' | 'ok',
            command,
            cwd,
            outputPreview: preview.text,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: preview.truncated || result.truncated,
            artifacts
          }

          if (stepError) {
            session.fail(
              payload,
              stepError,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_RUN_TOOL_SPEC.name,
                ok: false,
                code: 'failed',
                data: payload
              })
            )
            return payload
          }

          session.succeed(
            {
              command,
              outputPreview: payload.outputPreview,
              artifacts
            },
            undefined,
            buildTerminalToolResult({
              toolName: TERMINAL_RUN_TOOL_SPEC.name,
              ok: true,
              code: 'ok',
              data: payload
            })
          )
          return payload
        }
      }),
    {
      name: TERMINAL_RUN_TOOL_SPEC.name,
      description: TERMINAL_RUN_TOOL_SPEC.promptSpec.description,
      schema: TERMINAL_RUN_SCHEMA
    }
  )

  return {
    tools: [terminalRun],
    state
  }
}
