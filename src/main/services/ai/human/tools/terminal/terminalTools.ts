import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { isTerminalExcelMutationCommand } from './commandPolicy'
import {
  formatTerminalUnusableError,
  inspectTerminalOutputQuality,
  TERMINAL_UNUSABLE_OUTPUT_PLACEHOLDER
} from './terminalExec'
import { mapTerminalReadStatus, mapTerminalRunStatus } from './terminalToolStatus'
import { TERMINAL_MAX_CONCURRENT_SESSIONS } from './terminalConstants'
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import { createTerminalRunToolSpec, TERMINAL_READ_TOOL_SPEC } from './toolSpecs'

type PendingTerminalCommand = {
  terminalId: string
  ctx: TerminalToolContext
  runId: string
  partnerId: string
  taskId: string
  stepId: string
  stepIndex: number
  command: string
  cwd: string
  emitActivity: (activity: CapabilityActivityInput) => void
  finalized: boolean
  finalization?: Promise<void>
}

const pendingCommands = new Map<string, PendingTerminalCommand>()

const buildTerminalToolResult = (input: {
  toolName: string
  ok: boolean
  data: AiToolCallResult['data']
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data
})

const buildFailure = (input: { error: string }) => ({ error: input.error })

const SESSION_LIMIT_ERROR = 'terminal_session_limit_reached'

const buildSessionLimitReached = () => ({
  error: SESSION_LIMIT_ERROR,
  hint:
    `The current chat has reached its limit of ${TERMINAL_MAX_CONCURRENT_SESSIONS} running terminal sessions. ` +
    'Wait for a command to finish or run kill/pkill/taskkill in a new terminal session to terminate an existing command before retrying. Termination commands are exempt from this limit.'
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

const emitTerminalStepCompleted = (
  input: PendingTerminalCommand,
  exitCode: number,
  executionStatus: 'completed' | 'cancelled'
): void => {
  input.ctx.sendEvent({
    type: 'terminal_step_result',
    runId: input.runId,
    taskId: input.taskId,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    command: input.command,
    cwd: input.cwd,
    executionStatus,
    exitCode,
    timedOut: false,
    completedAt: Date.now()
  })
  input.emitActivity({
    actionType: 'terminal_exec',
    status: 'completed',
    summary:
      executionStatus === 'cancelled'
        ? `${input.command} -> cancelled`
        : `${input.command} -> exit ${String(exitCode)}`
  })
}

const emitTerminalStepFailed = (input: PendingTerminalCommand, error: string): void => {
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

const finalizeCommand = async (input: {
  commandId: string
  exitCode: number
  executionStatus?: 'completed' | 'cancelled'
}): Promise<void> => {
  const pending = pendingCommands.get(input.commandId)
  if (!pending) return
  if (pending.finalization) return await pending.finalization
  pending.finalized = true
  pending.finalization = (async () => {
    emitTerminalStepCompleted(pending, input.exitCode, input.executionStatus || 'completed')
    pendingCommands.delete(input.commandId)
  })()
  await pending.finalization
}

const failCommand = async (commandId: string, error: unknown): Promise<void> => {
  const pending = pendingCommands.get(commandId)
  if (!pending) return
  if (pending.finalization) return await pending.finalization
  pending.finalized = true
  pending.finalization = (async () => {
    emitTerminalStepFailed(pending, error instanceof Error ? error.message : String(error))
    pendingCommands.delete(commandId)
  })()
  await pending.finalization
}

const applyOutputGuards = (input: {
  toolName: string
  output: string
}):
  | { ok: true; output: string }
  | {
      ok: false
      output: string
      error: string
      estimatedTokens?: number
      limit?: number
    } => {
  const quality = inspectTerminalOutputQuality(input.output, '')
  if (quality.unusable) {
    return {
      ok: false,
      output: TERMINAL_UNUSABLE_OUTPUT_PLACEHOLDER,
      error: formatTerminalUnusableError({ report: quality, output: input.output })
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

  const terminalRun = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: terminalRunToolSpec.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          const maxWaitSeconds =
            typeof args.maxWaitSeconds === 'number' && Number.isFinite(args.maxWaitSeconds)
              ? Math.trunc(args.maxWaitSeconds)
              : undefined
          if (!command) {
            const failure = buildFailure({ error: 'empty command' })
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
          if (isTerminalExcelMutationCommand(command)) {
            const failure = buildFailure({
              error:
                'Do not use terminal commands to create or modify Excel files. Use excel_edit instead.'
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

          // Default session start is homedir.
          const cwd = input.workspaceRootPath
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
              chatSessionId: input.partnerId,
              workspaceId: input.workspaceId,
              workspaceRootPath: input.workspaceRootPath,
              environment: input.ctx.humanRuntimeOverrides?.terminalEnvironment,
              platform: input.ctx.platform,
              runId: input.runId,
              command,
              maxWaitSeconds
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failure =
              message === SESSION_LIMIT_ERROR
                ? buildSessionLimitReached()
                : buildFailure({ error: message })
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

          pendingCommands.set(result.commandId, {
            terminalId: result.terminalId,
            ctx: input.ctx,
            runId: input.runId,
            partnerId: input.partnerId,
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
              readEndPosition: result.readEndPosition,
              createdAt: Date.now()
            })
            void input.sessionManager
              .waitForCommand({
                terminalId: result.terminalId,
                commandId: result.commandId,
                chatSessionId: input.partnerId,
                workspaceId: input.workspaceId
              })
              .then(async (exitCode) => {
                await finalizeCommand({ commandId: result.commandId, exitCode })
              })
              .catch((error) => void failCommand(result.commandId, error))
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
          if (result.returnReason === 'command_stopped') {
            await finalizeCommand({
              commandId: result.commandId,
              exitCode: result.exitCode ?? 130,
              executionStatus: 'cancelled'
            })
          }
          const guarded = applyOutputGuards({
            toolName: terminalRunToolSpec.name,
            output: result.output
          })
          const status = mapTerminalRunStatus(result.returnReason, result.exitCode)
          const payload = {
            terminalId: result.terminalId,
            status,
            output: guarded.output,
            readEndPosition: result.readEndPosition,
            hasMoreOutput: result.hasMoreOutput
          }
          if (!guarded.ok) {
            const failurePayload = {
              ...payload,
              output: guarded.output,
              error: guarded.error
            }
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
          const terminalId = String(args.terminalId || '').trim()
          try {
            const result = await input.sessionManager.read({
              terminalId,
              chatSessionId: input.partnerId,
              workspaceId: input.workspaceId,
              readEndPosition:
                typeof args.readEndPosition === 'number' ? args.readEndPosition : undefined
            })
            const pending = Array.from(pendingCommands.entries()).find(
              ([, value]) =>
                value.partnerId === input.partnerId &&
                value.terminalId === result.terminalId &&
                result.terminalStatus !== 'running'
            )
            if (pending && result.exitCode !== null) {
              await finalizeCommand({ commandId: pending[0], exitCode: result.exitCode })
            }
            const guarded = applyOutputGuards({
              toolName: TERMINAL_READ_TOOL_SPEC.name,
              output: result.output
            })
            const status = mapTerminalReadStatus(
              result.terminalStatus,
              result.exitCode,
              result.hasMoreOutput
            )
            const payload = {
              status,
              output: guarded.output,
              readEndPosition: result.readEndPosition,
              hasMoreOutput: result.hasMoreOutput
            }
            if (!guarded.ok) {
              const failurePayload = {
                ...payload,
                output: guarded.output,
                error: guarded.error
              }
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
            const failure = buildFailure({ error: message })
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

  return { tools: [terminalRun, terminalRead], state }
}
