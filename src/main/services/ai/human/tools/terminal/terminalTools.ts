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
import {
  analyzeSafeTerminalCommandPolicy,
  checkWorkspaceBoundary,
  parseTerminalCommandTokens
} from './commandPolicy'
import { inspectTerminalOutputQuality } from './terminalExec'
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import {
  createTerminalRunToolSpec,
  TERMINAL_READ_TOOL_SPEC,
  TERMINAL_STOP_TOOL_SPEC
} from './toolSpecs'

type PendingTerminalCommand = {
  terminalId: string
  ctx: TerminalToolContext
  runId: string
  sessionId: string
  taskId: string
  stepId: string
  stepIndex: number
  command: string
  cwd: string
  emitActivity: (activity: CapabilityActivityInput) => void
  finalized: boolean
}

const pendingCommands = new Map<string, PendingTerminalCommand>()

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
  if (count === 1) approvedCounts.delete(key)
  else approvedCounts.set(key, count - 1)
  return true
}

const hasDetachedExecution = (
  command: string,
  platform: TerminalToolContext['platform']
): boolean => {
  const tokens = parseTerminalCommandTokens(command, { windowsStyle: platform === 'windows' })
  if (tokens.some((token) => /^(nohup|start-process)$/i.test(token))) return true
  if (platform === 'windows') return false

  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '&' && command[index - 1] !== '&' && command[index + 1] !== '&') return true
  }
  return false
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

const emitTerminalStepCompleted = (input: PendingTerminalCommand, exitCode: number): void => {
  if (exitCode === 0) {
    input.ctx.sendEvent({
      type: 'terminal_step_result',
      runId: input.runId,
      taskId: input.taskId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      command: input.command,
      cwd: input.cwd,
      exitCode,
      timedOut: false,
      completedAt: Date.now()
    })
    input.emitActivity({
      actionType: 'terminal_exec',
      status: 'completed',
      summary: `${input.command} -> success`
    })
    return
  }

  const error = `command exited with code ${String(exitCode)}`
  input.ctx.sendEvent({
    type: 'terminal_step_error',
    runId: input.runId,
    taskId: input.taskId,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    command: input.command,
    cwd: input.cwd,
    error,
    completedAt: Date.now()
  })
  input.emitActivity({ actionType: 'terminal_exec', status: 'failed', summary: error })
}

const finalizeCommand = async (input: { commandId: string; exitCode: number }): Promise<void> => {
  const pending = pendingCommands.get(input.commandId)
  if (!pending || pending.finalized) return
  pending.finalized = true
  emitTerminalStepCompleted(pending, input.exitCode)
  pendingCommands.delete(input.commandId)
}

const readSessionCwd = (input: TerminalCapabilityToolsInput, terminalId?: string): string => {
  if (!terminalId) return input.workspaceRootPath
  return (
    input.sessionManager
      .list({ chatSessionId: input.sessionId, workspaceId: input.workspaceId })
      .find((session) => session.terminalId === terminalId)?.currentTerminalPath ||
    input.workspaceRootPath
  )
}

const applyOutputGuards = (input: {
  toolName: string
  output: string
  modelContextWindowTokens: number
  ratio: number
}):
  | { ok: true; output: string }
  | {
      ok: false
      output: string
      error: string
      reason: 'result_too_large' | 'result_unusable'
      decisionHint: HumanDecisionHint
      estimatedTokens?: number
      limit?: number
    } => {
  const quality = inspectTerminalOutputQuality(input.output, '')
  if (quality.unusable) {
    return {
      ok: false,
      output: '[terminal output omitted: unusable non-text content detected]',
      error: 'terminal result unusable',
      reason: 'result_unusable',
      decisionHint: buildResultUnusableDecisionHint({ toolName: input.toolName, quality })
    }
  }
  const limit = getAiResultTokenLimit({
    modelContextWindowTokens: input.modelContextWindowTokens,
    ratio: input.ratio
  })
  const estimatedTokens = estimateToolResultTokens(input.output)
  if (estimatedTokens > limit) {
    return {
      ok: false,
      output: '',
      error: 'terminal result too large',
      reason: 'result_too_large',
      estimatedTokens,
      limit,
      decisionHint: buildResultTooLargeDecisionHint({
        toolName: input.toolName,
        estimatedTokens,
        limit
      })
    }
  }
  return { ok: true, output: input.output }
}

export const buildTerminalCapabilityTools = (input: TerminalCapabilityToolsInput) => {
  const terminalRunToolSpec = createTerminalRunToolSpec(input.ctx.platform)
  const state: TerminalCapabilityToolsRuntimeState = { stepIndex: 0 }
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })
  const modelContextWindowTokens =
    input.ctx.humanRuntimeOverrides?.modelContextWindowTokens || DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS

  const terminalRun = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: terminalRunToolSpec.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          const commandExplanation = String(args.commandExplanation || '').trim()
          const terminalId = String(args.terminalId || '').trim() || undefined
          if (!command) {
            const failure = buildFailure({ reason: 'invalid_input', error: 'empty command' })
            session.fail(
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }
          if (hasDetachedExecution(command, input.ctx.platform)) {
            const failure = buildFailure({
              reason: 'invalid_input',
              error: 'detached shell execution is not supported in persistent terminals'
            })
            session.fail(
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }

          const cwd = readSessionCwd(input, terminalId)
          const boundary = checkWorkspaceBoundary(
            command,
            input.workspaceRootPath,
            input.ctx.platform
          )
          if (!boundary.ok) {
            const failure = buildFailure({
              reason: 'workspace_required',
              error: `workspace boundary check failed: ${boundary.reason}`
            })
            session.fail(
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }

          const safePolicy = analyzeSafeTerminalCommandPolicy(command, input.ctx.platform)
          const approvedByHand = consumeApprovedTerminalCommand({ cache: input.cache, command })
          if (safePolicy.executionPolicy !== 'safe_allowed' && !approvedByHand) {
            const approval = await input.ctx.requestApprovalBatch({
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
                  commandExplanation: commandExplanation || '执行这条终端指令。',
                  reason: safePolicy.reason
                }
              ]
            })
            const approved =
              approval.accepted &&
              approval.decisions.length === 1 &&
              approval.decisions[0]?.action === 'approve'
            if (!approved) {
              const failure = buildFailure({
                reason: 'approval_denied',
                error: `command requires approval preflight: ${safePolicy.reason}`
              })
              session.fail(
                failure.error,
                undefined,
                buildTerminalToolResult({
                  toolName: terminalRunToolSpec.name,
                  ok: false,
                  data: failure
                })
              )
              return failure
            }
          }

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

          let result
          try {
            result = await input.sessionManager.run({
              chatSessionId: input.sessionId,
              workspaceId: input.workspaceId,
              workspaceRootPath: input.workspaceRootPath,
              platform: input.ctx.platform,
              runId: input.runId,
              command,
              terminalId
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failure = buildFailure({ reason: 'invalid_input', error: message })
            session.fail(
              message,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }

          pendingCommands.set(result.commandId, {
            terminalId: result.terminalId,
            ctx: input.ctx,
            runId: input.runId,
            sessionId: input.sessionId,
            taskId: input.taskId,
            stepId,
            stepIndex: state.stepIndex,
            command,
            cwd,
            emitActivity: input.emitActivity,
            finalized: false
          })

          if (result.returnReason === 'command_still_running') {
            input.ctx.sendEvent({
              type: 'terminal_command_yielded',
              runId: input.runId,
              taskId: input.taskId,
              terminalId: result.terminalId,
              commandId: result.commandId,
              currentTerminalPath: result.currentTerminalPath,
              outputCursor: result.outputCursor,
              createdAt: Date.now()
            })
            void input.sessionManager
              .waitForCommand({
                terminalId: result.terminalId,
                commandId: result.commandId,
                chatSessionId: input.sessionId,
                workspaceId: input.workspaceId
              })
              .then(async (exitCode) => {
                await finalizeCommand({ commandId: result.commandId, exitCode })
              })
              .catch((error) => {
                input.emitActivity({
                  actionType: 'terminal_exec',
                  status: 'failed',
                  summary: error instanceof Error ? error.message : String(error)
                })
              })
          }

          if (
            result.returnReason === 'command_completed' ||
            result.returnReason === 'terminal_closed'
          ) {
            await finalizeCommand({
              commandId: result.commandId,
              exitCode: result.exitCode ?? 1
            })
          }
          const guarded = applyOutputGuards({
            toolName: terminalRunToolSpec.name,
            output: result.output,
            modelContextWindowTokens,
            ratio: input.aiResultTokenLimitRatio
          })
          const { commandId: _commandId, ...publicResult } = result
          const payload = { ...publicResult, output: guarded.output }
          if (!guarded.ok) {
            const failurePayload = { ...payload, ...guarded }
            session.fail(
              guarded.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failurePayload
              })
            )
            return failurePayload
          }
          if (result.returnReason !== 'command_still_running' && result.exitCode !== 0) {
            const failurePayload = {
              ...payload,
              reason: 'failed',
              error: `command exited with code ${String(result.exitCode)}`
            }
            session.fail(
              failurePayload.error,
              undefined,
              buildTerminalToolResult({
                toolName: terminalRunToolSpec.name,
                ok: false,
                data: failurePayload
              })
            )
            return failurePayload
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

  const terminalRead = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: TERMINAL_READ_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          try {
            const result = input.sessionManager.read({
              terminalId: String(args.terminalId || ''),
              chatSessionId: input.sessionId,
              workspaceId: input.workspaceId,
              outputCursor: typeof args.outputCursor === 'number' ? args.outputCursor : undefined
            })
            const pending = Array.from(pendingCommands.entries()).find(
              ([, value]) =>
                value.sessionId === input.sessionId &&
                value.terminalId === result.terminalId &&
                !value.finalized &&
                result.terminalStatus !== 'running'
            )
            if (pending && result.exitCode !== null) {
              await finalizeCommand({ commandId: pending[0], exitCode: result.exitCode })
            }
            const guarded = applyOutputGuards({
              toolName: TERMINAL_READ_TOOL_SPEC.name,
              output: result.output,
              modelContextWindowTokens,
              ratio: input.aiResultTokenLimitRatio
            })
            const payload = { ...result, output: guarded.output }
            if (!guarded.ok) {
              const failurePayload = { ...payload, ...guarded }
              session.fail(
                guarded.error,
                undefined,
                buildTerminalToolResult({
                  toolName: TERMINAL_READ_TOOL_SPEC.name,
                  ok: false,
                  data: failurePayload
                })
              )
              return failurePayload
            }
            session.succeed(
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_READ_TOOL_SPEC.name,
                ok: true,
                data: payload
              })
            )
            return payload
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failure = buildFailure({ reason: 'invalid_input', error: message })
            session.fail(
              message,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_READ_TOOL_SPEC.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }
        }
      }),
    {
      name: TERMINAL_READ_TOOL_SPEC.name,
      description: TERMINAL_READ_TOOL_SPEC.promptSpec.description,
      schema: TERMINAL_READ_TOOL_SPEC.inputSchema
    }
  )

  const terminalStop = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: TERMINAL_STOP_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          try {
            const result = await input.sessionManager.stop({
              terminalId: String(args.terminalId || ''),
              chatSessionId: input.sessionId,
              workspaceId: input.workspaceId,
              closeTerminal: args.closeTerminal === true
            })
            input.ctx.sendEvent({
              type: 'terminal_command_stopped',
              runId: input.runId,
              taskId: input.taskId,
              terminalId: result.terminalId,
              forced: result.forced,
              createdAt: Date.now()
            })
            if (result.terminalStatus === 'closed') {
              input.ctx.sendEvent({
                type: 'terminal_session_closed',
                runId: input.runId,
                taskId: input.taskId,
                terminalId: result.terminalId,
                createdAt: Date.now()
              })
            }
            const pending = Array.from(pendingCommands.entries()).find(
              ([, value]) =>
                value.sessionId === input.sessionId &&
                value.terminalId === result.terminalId &&
                !value.finalized
            )
            if (pending) {
              await finalizeCommand({ commandId: pending[0], exitCode: 130 })
            }
            session.succeed(
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_STOP_TOOL_SPEC.name,
                ok: true,
                data: result
              })
            )
            return result
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failure = buildFailure({ reason: 'invalid_input', error: message })
            session.fail(
              message,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_STOP_TOOL_SPEC.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }
        }
      }),
    {
      name: TERMINAL_STOP_TOOL_SPEC.name,
      description: TERMINAL_STOP_TOOL_SPEC.promptSpec.description,
      schema: TERMINAL_STOP_TOOL_SPEC.inputSchema
    }
  )

  return { tools: [terminalRun, terminalRead, terminalStop], state }
}
