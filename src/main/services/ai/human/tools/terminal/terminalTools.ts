import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, JsonObject, IpcJsonObject } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import type { HumanDecisionHint } from '../../types'
import { getAiResultTokenLimit, estimateToolResultTokens } from '../utils/resultSizeGuard'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import {
  analyzeSafeTerminalCommandPolicy,
  analyzeTerminalCommand,
  checkWorkspaceBoundary,
  resolveTerminalCwd
} from './commandPolicy'
import { inspectTerminalOutputQuality, runTerminalCommand } from './terminalExec'
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import { createTerminalRunToolSpec } from './toolSpecs'

const isJsonObjectRecord = (value: AiToolCallResult['data']): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const buildTerminalToolResult = (input: {
  toolName: string
  ok: boolean
  data: AiToolCallResult['data']
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data,
  diagnostic:
    input.ok || !isJsonObjectRecord(input.data)
      ? undefined
      : typeof input.data.error === 'string' && input.data.error.trim()
        ? { message: input.data.error.trim() }
        : undefined
})

const buildFailure = <TReason extends string>(input: { reason: TReason; error: string }) => ({
  reason: input.reason,
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

const buildResultTooLargeDecisionHint = (input: {
  toolName: string
  estimatedTokens: number
  limit: number
}): Extract<HumanDecisionHint, { code: 'hand_tool_result_too_large' }> => ({
  code: 'hand_tool_result_too_large',
  detail: {
    toolName: input.toolName,
    estimatedTokens: input.estimatedTokens,
    limit: input.limit
  }
})

const buildResultUnusableDecisionHint = (input: {
  toolName: string
  quality: ReturnType<typeof inspectTerminalOutputQuality>
}): Extract<HumanDecisionHint, { code: 'hand_tool_result_unusable' }> => ({
  code: 'hand_tool_result_unusable',
  detail: {
    toolName: input.toolName,
    reason: 'non_text_output',
    totalChars: input.quality.totalChars,
    nulCount: input.quality.nulCount,
    replacementCharCount: input.quality.replacementCharCount,
    replacementCharRatio: input.quality.replacementCharRatio,
    controlCharCount: input.quality.controlCharCount,
    controlCharRatio: input.quality.controlCharRatio,
    matchedSignatures: input.quality.matchedSignatures
  }
})

const buildTerminalTokenEstimateSource = (input: { stdout: string; stderr: string }): string => {
  if (input.stdout && input.stderr) return `${input.stdout}\n${input.stderr}`
  return input.stdout || input.stderr
}

const buildApprovedTerminalCommandKey = (command: string): string => String(command || '').trim()

const consumeApprovedTerminalCommand = (input: {
  cache: TerminalCapabilityToolsInput['cache']
  command: string
}): boolean => {
  const approvedCounts = input.cache.approvedTerminalCommandCounts
  if (!approvedCounts) return false

  const key = buildApprovedTerminalCommandKey(input.command)
  const count = approvedCounts.get(key) || 0
  if (count <= 0) return false

  if (count === 1) {
    approvedCounts.delete(key)
  } else {
    approvedCounts.set(key, count - 1)
  }
  return true
}

export const buildTerminalCapabilityTools = (input: TerminalCapabilityToolsInput) => {
  const terminalRunToolSpec = createTerminalRunToolSpec(input.ctx.platform)
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
        toolName: terminalRunToolSpec.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          if (!command) {
            const emptyResult = buildFailure({
              reason: 'invalid_input',
              error: 'empty command'
            })
            session.fail(
              emptyResult.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
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
              reason: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(
              cwdError.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: cwdError
              })
            )
            return cwdError
          }
          const cwd = cwdResult.cwd

          const boundary = checkWorkspaceBoundary(
            command,
            input.workspaceRootPath,
            input.ctx.platform
          )
          if (!boundary.ok) {
            const boundaryError = buildFailure({
              reason: 'workspace_required',
              error: `workspace boundary check failed: ${boundary.reason}`
            })
            session.fail(
              boundaryError.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: boundaryError
              })
            )
            return boundaryError
          }

          const analysis = analyzeTerminalCommand({
            command,
            cwd: args.cwd,
            platform: input.ctx.platform
          })
          const safePolicy = analyzeSafeTerminalCommandPolicy(command, input.ctx.platform)
          const approvedByHand = consumeApprovedTerminalCommand({
            cache: input.cache,
            command
          })
          if (safePolicy.executionPolicy !== 'safe_allowed' && !approvedByHand) {
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
                  toolName: terminalRunToolSpec.name,
                  command,
                  reason: safePolicy.reason
                }
              ]
            })
            const approved =
              approvalBatchResult.accepted &&
              approvalBatchResult.decisions.length === 1 &&
              approvalBatchResult.decisions[0]?.action === 'approve'
            if (!approved) {
              const denied = buildFailure({
                reason: 'approval_denied',
                error: `command requires approval preflight: ${safePolicy.reason}`
              })
              session.fail(
                denied.error,
                undefined,
                buildTerminalToolResult({
                  toolName: terminalRunToolSpec.name,
                  ok: false,
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
          const outputQuality = inspectTerminalOutputQuality(result.stdout, result.stderr)

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
            cwd,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stepError,
            emitActivity: input.emitActivity
          })

          const aiResultTokenLimit = getAiResultTokenLimit({
            modelContextWindowTokens:
              input.ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
              DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
            ratio: input.aiResultTokenLimitRatio
          })
          const estimatedTokens = estimateToolResultTokens(buildTerminalTokenEstimateSource(result))
          const tooLarge = !stepError && estimatedTokens > aiResultTokenLimit

          const payload = {
            stdout: outputQuality.unusable
              ? '[terminal output omitted: unusable non-text content detected]'
              : result.stdout,
            stderr: outputQuality.unusable ? '' : result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            artifacts
          } as {
            stdout: string
            stderr: string
            exitCode: number | null
            timedOut: boolean
            artifacts: typeof artifacts
            error?: string
            reason?: 'failed' | 'result_too_large' | 'result_unusable'
            estimatedTokens?: number
            limit?: number
            decisionHint?: HumanDecisionHint
          }

          if (stepError) {
            payload.reason = 'failed'
            payload.error = stepError
            session.fail(
              stepError,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: payload
              })
            )
            return payload
          }

          if (outputQuality.unusable) {
            payload.reason = 'result_unusable'
            payload.error = 'terminal result unusable'
            payload.decisionHint = buildResultUnusableDecisionHint({
              toolName: terminalRunToolSpec.name,
              quality: outputQuality
            })
            session.fail(
              payload.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: payload
              })
            )
            return payload
          }

          if (tooLarge) {
            payload.reason = 'result_too_large'
            payload.estimatedTokens = estimatedTokens
            payload.limit = aiResultTokenLimit
            payload.decisionHint = buildResultTooLargeDecisionHint({
              toolName: terminalRunToolSpec.name,
              estimatedTokens,
              limit: aiResultTokenLimit
            })
            payload.error = 'terminal result too large'
            session.fail(
              payload.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: payload
              })
            )
            return payload
          }

          session.succeed(
            undefined,
            buildTerminalToolResult({
              toolName: terminalRunToolSpec.name,
              ok: true,
              data: payload
            })
          )
          return payload
        }
      }),
    {
      name: terminalRunToolSpec.name,
      description: terminalRunToolSpec.promptSpec.description,
      schema: terminalRunToolSpec.inputSchema
    }
  )

  return {
    tools: [terminalRun],
    state
  }
}
