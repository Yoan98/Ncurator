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
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import type { TerminalSessionEntry, TerminalSessionLimitOutput } from './outputTypes'
import {
  createTerminalRunToolSpec,
  TERMINAL_READ_TOOL_SPEC,
  TERMINAL_STOP_TOOL_SPEC
} from './toolSpecs'

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

const terminalSessionStatusRank = (status: TerminalSessionEntry['status']): number =>
  status === 'idle' ? 1 : 0

const listTerminalSessionEntries = (input: {
  sessionManager: TerminalCapabilityToolsInput['sessionManager']
  chatSessionId: string
}): TerminalSessionEntry[] =>
  input.sessionManager
    .list({ chatSessionId: input.chatSessionId })
    .map(
      (session): TerminalSessionEntry => ({
        terminalId: session.terminalId,
        status:
          session.status === 'running' || session.status === 'stopping' ? session.status : 'idle',
        command: session.currentCommand || '',
        runningSeconds: session.startedAt
          ? Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))
          : 0
      })
    )
    // 先列正在占额度的会话，模型按顺序回收即可恢复。
    .sort(
      (left, right) =>
        terminalSessionStatusRank(left.status) - terminalSessionStatusRank(right.status)
    )

const buildSessionLimitReached = (input: {
  sessions: TerminalSessionEntry[]
}): TerminalSessionLimitOutput => ({
  error: SESSION_LIMIT_ERROR,
  sessions: input.sessions
})

const findPendingCommand = (input: {
  partnerId: string
  terminalId: string
}): [string, PendingTerminalCommand] | undefined =>
  Array.from(pendingCommands.entries()).find(
    ([, value]) => value.partnerId === input.partnerId && value.terminalId === input.terminalId
  )

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
              environment: {
                ...input.ctx.terminalEnvironment,
                ...input.ctx.humanRuntimeOverrides?.terminalEnvironment
              },
              platform: input.ctx.platform,
              runId: input.runId,
              command,
              maxWaitSeconds
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const failure =
              message === SESSION_LIMIT_ERROR
                ? buildSessionLimitReached({
                    sessions: listTerminalSessionEntries({
                      sessionManager: input.sessionManager,
                      chatSessionId: input.partnerId
                    })
                  })
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
              .then(async ({ exitCode, returnReason }) => {
                await finalizeCommand({
                  commandId: result.commandId,
                  exitCode,
                  executionStatus:
                    returnReason === 'command_stopped' || returnReason === 'terminal_closed'
                      ? 'cancelled'
                      : 'completed'
                })
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
            const pending = findPendingCommand({
              partnerId: input.partnerId,
              terminalId: result.terminalId
            })
            if (pending && result.terminalStatus !== 'running' && result.exitCode !== null) {
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

  const terminalStop = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: TERMINAL_STOP_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const terminalId = String(args.terminalId || '').trim()
          if (!terminalId) {
            const failure = buildFailure({ error: 'empty terminalId' })
            session.fail(
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_STOP_TOOL_SPEC.name,
                ok: false,
                data: failure
              })
            )
            return failure
          }
          try {
            const result = await input.sessionManager.stop({
              terminalId,
              chatSessionId: input.partnerId,
              workspaceId: input.workspaceId,
              closeTerminal: true
            })
            const pending = findPendingCommand({ partnerId: input.partnerId, terminalId })
            const commandId = result.commandId ?? pending?.[0]
            if (commandId) {
              await finalizeCommand({
                commandId,
                exitCode: result.exitCode ?? 130,
                executionStatus: 'cancelled'
              })
            }
            const payload = { terminalId, status: 'stopped' as const }
            session.succeed(
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_STOP_TOOL_SPEC.name,
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
