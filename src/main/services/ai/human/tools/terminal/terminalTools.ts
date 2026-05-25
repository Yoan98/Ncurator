import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  AiToolCallResult,
  JsonObject,
  IpcJsonObject
} from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import type { HumanDecisionHint } from '../../types'
import { getAiResultTokenLimit, estimateToolResultTokens } from '../utils/resultSizeGuard'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import { analyzeTerminalCommand, checkWorkspaceBoundary } from './terminalCommandPolicy'
import { analyzeReadonlyTerminalCommandPolicy } from './readonlyCommandPolicy'
import { resolveTerminalCwd } from './terminalCwd'
import { runTerminalCommand } from './terminalExec'
import type {
  TerminalCapabilityToolsInput,
  TerminalCapabilityToolsRuntimeState
} from './types'
import {
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
  cwd: string
  exitCode: number | null
  timedOut: boolean
  captureLimited: boolean
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
      cwd: input.cwd,
      error: input.stepError,
      captureLimited: input.captureLimited,
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
    cwd: input.cwd,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    captureLimited: input.captureLimited,
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
  captureLimited: boolean
}): string | undefined =>
  input.timedOut
    ? `command timed out after ${input.timeoutMs}ms`
    : input.captureLimited
      ? 'command output exceeded capture hard limit'
    : input.exitCode !== 0
      ? `command exited with code ${String(input.exitCode)}`
      : undefined

const buildResultTooLargeDecisionHint = (input: {
  command: string
  cwd: string
  estimatedTokens: number
  limit: number
  captureLimited: boolean
}): Extract<HumanDecisionHint, { code: 'hand_tool_result_too_large' }> => ({
  code: 'hand_tool_result_too_large',
  detail: {
    toolName: TERMINAL_RUN_TOOL_SPEC.name,
    command: input.command,
    cwd: input.cwd,
    estimatedTokens: input.estimatedTokens,
    limit: input.limit,
    captureLimited: input.captureLimited,
    suggestedActions: [
      '先进入更小目录再查看',
      '先列目录或筛文件名，再读取具体文件',
      '避免对大范围目录直接执行全量输出命令'
    ],
    suggestedCommands: [
      'ls 工作',
      "find 工作 -maxdepth 2 -type f | rg '关键字'",
      "rg -n '关键字' 工作"
    ]
  }
})

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
          const readonlyPolicy = analyzeReadonlyTerminalCommandPolicy(command)
          if (readonlyPolicy.executionPolicy !== 'readonly_allowed') {
            const approvalBatchResult = await input.ctx.requestApprovalBatch({
              runId: input.runId,
              taskId: input.taskId,
              batchId: randomUUID(),
              stage: 'human_hand',
              internal: true,
              items: [
                {
                  itemId: randomUUID(),
                  order: 0,
                  toolName: TERMINAL_RUN_TOOL_SPEC.name,
                  command,
                  reason: readonlyPolicy.reason
                }
              ]
            })
            const approved =
              approvalBatchResult.accepted &&
              approvalBatchResult.decisions.length === 1 &&
              approvalBatchResult.decisions[0]?.action === 'approve'
            if (!approved) {
              const denied = buildFailure({
                code: 'approval_denied',
                error: `command requires approval preflight: ${readonlyPolicy.reason}`
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
            captureHardLimitChars: input.captureHardLimitChars
          })

          const stepError = buildTerminalStepError({
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            timeoutMs: input.timeoutMs,
            captureLimited: result.captureLimited
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
            cwd,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            captureLimited: result.captureLimited,
            stepError,
            emitActivity: input.emitActivity
          })

          const aiResultTokenLimit = getAiResultTokenLimit({
            modelContextWindowTokens:
              input.ctx.humanRuntimeOverrides?.modelContextWindowTokens
              || DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
            ratio: input.aiResultTokenLimitRatio
          })
          const estimatedTokens = estimateToolResultTokens(result.combinedOutput)
          const tooLarge = !stepError && estimatedTokens > aiResultTokenLimit

          const payload = {
            ok: !stepError && !tooLarge,
            code: (stepError ? 'failed' : tooLarge ? 'result_too_large' : 'ok') as
              'failed' | 'ok' | 'result_too_large',
            command,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
            combinedOutput: result.combinedOutput,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            captureLimited: result.captureLimited,
            artifacts
          } as {
            ok: boolean
            code: 'failed' | 'ok' | 'result_too_large'
            command: string
            cwd: string
            stdout: string
            stderr: string
            combinedOutput: string
            exitCode: number | null
            timedOut: boolean
            captureLimited: boolean
            artifacts: typeof artifacts
            error?: string
            estimatedTokens?: number
            limit?: number
            decisionHint?: HumanDecisionHint
          }

          if (stepError) {
            payload.error = stepError
            session.fail(
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

          if (tooLarge) {
            payload.estimatedTokens = estimatedTokens
            payload.limit = aiResultTokenLimit
            payload.decisionHint = buildResultTooLargeDecisionHint({
              command,
              cwd,
              estimatedTokens,
              limit: aiResultTokenLimit,
              captureLimited: result.captureLimited
            })
            payload.error = 'terminal result too large'
            session.fail(
              payload.error,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_RUN_TOOL_SPEC.name,
                ok: false,
                code: 'result_too_large',
                data: payload
              })
            )
            return payload
          }

          session.succeed(
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
      schema: TERMINAL_RUN_TOOL_SPEC.inputSchema
    }
  )

  return {
    tools: [terminalRun],
    state
  }
}
