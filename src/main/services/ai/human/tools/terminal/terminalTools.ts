import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import { getAiResultTokenLimit, estimateToolResultTokens } from '../utils/resultSizeGuard'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import {
  analyzeTerminalCommandPolicy,
  hasDetachedExecution,
  isTerminalExcelMutationCommand
} from './commandPolicy'
import { inspectTerminalOutputQuality } from './terminalExec'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import {
  createTerminalRunToolSpec,
  TERMINAL_READ_TOOL_SPEC
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
  trackingId?: string
  emitActivity: (activity: CapabilityActivityInput) => void
  finalized: boolean
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

const finishTerminalFileChangeTracking = async (pending: PendingTerminalCommand): Promise<void> => {
  if (!pending.trackingId) return
  try {
    const records = await pending.ctx.finishTerminalCommandTracking(pending.trackingId)
    records.forEach((record) => {
      if (record.status !== 'applied') return
      emitFileArtifactEvent({
        ctx: pending.ctx,
        runId: pending.runId,
        taskId: pending.taskId,
        capability:
          record.capability === 'docx' || record.capability === 'text_file'
            ? record.capability
            : 'terminal_exec',
        artifactPath: record.path,
        operation: record.operation,
        applyId: record.id,
        changeCount: record.changeCount,
        insertCount: record.insertCount,
        deleteCount: record.deleteCount,
        stepId: pending.stepId
      })
    })
  } catch (error) {
    console.error('[TERMINAL] file change tracking failed:', error)
  }
}

const finalizeCommand = async (input: {
  commandId: string
  exitCode: number
  executionStatus?: 'completed' | 'cancelled'
}): Promise<void> => {
  const pending = pendingCommands.get(input.commandId)
  if (!pending || pending.finalized) return
  pending.finalized = true
  await finishTerminalFileChangeTracking(pending)
  emitTerminalStepCompleted(pending, input.exitCode, input.executionStatus || 'completed')
  pendingCommands.delete(input.commandId)
}

const failCommand = async (commandId: string, error: unknown): Promise<void> => {
  const pending = pendingCommands.get(commandId)
  if (!pending || pending.finalized) return
  pending.finalized = true
  await finishTerminalFileChangeTracking(pending)
  emitTerminalStepFailed(pending, error instanceof Error ? error.message : String(error))
  pendingCommands.delete(commandId)
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
      estimatedTokens?: number
      limit?: number
    } => {
  const quality = inspectTerminalOutputQuality(input.output, '')
  if (quality.unusable) {
    return {
      ok: false,
      output: '[terminal output omitted: unusable non-text content detected]',
      error: 'terminal result unusable'
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
      estimatedTokens,
      limit
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
          if (hasDetachedExecution(command, input.ctx.platform)) {
            const failure = buildFailure({
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

          if (isTerminalExcelMutationCommand(command)) {
            const failure = buildFailure({
              error: '禁止使用 terminal_exec 创建或修改 Excel 文件，请使用 excel_edit。'
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

          const cwd = input.workspaceRootPath
          const riskPolicy = analyzeTerminalCommandPolicy(command, input.ctx.platform)
          const approvedByHand = consumeApprovedTerminalCommand({ cache: input.cache, command })
          if (riskPolicy.executionPolicy === 'approval_required' && !approvedByHand) {
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
                  reason: riskPolicy.reason
                }
              ]
            })
            const approved =
              approval.accepted &&
              approval.decisions.length === 1 &&
              approval.decisions[0]?.action === 'approve'
            if (!approved) {
              input.ctx.checkCancelled()
              const notExecuted = {
                executionStatus: 'not_executed' as const,
                reason: 'approval_denied',
                output: ''
              }
              session.succeed(
                undefined,
                buildTerminalToolResult({
                  toolName: terminalRunToolSpec.name,
                  ok: true,
                  data: notExecuted
                })
              )
              return notExecuted
            }
          }

          state.stepIndex += 1
          const stepId = randomUUID()
          const trackingId = randomUUID()
          let trackingStarted = false
          try {
            await input.ctx.beginTerminalCommandTracking({
              commandId: trackingId,
              runId: input.runId,
              sessionId: input.sessionId,
              workspaceRootPath: input.workspaceRootPath,
              command
            })
            trackingStarted = true
          } catch (error) {
            console.error('[TERMINAL] file change baseline failed:', error)
          }
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
              environment: input.ctx.humanRuntimeOverrides?.terminalEnvironment,
              platform: input.ctx.platform,
              runId: input.runId,
              command
            })
          } catch (error) {
            if (trackingStarted) input.ctx.discardTerminalCommandTracking(trackingId)
            const message = error instanceof Error ? error.message : String(error)
            const failure = buildFailure({ error: message })
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
            trackingId: trackingStarted ? trackingId : undefined,
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
            output: result.output,
            modelContextWindowTokens,
            ratio: input.aiResultTokenLimitRatio
          })
          const publicResult = {
            terminalId: result.terminalId,
            terminalStatus: result.terminalStatus,
            outputCursor: result.outputCursor,
            exitCode: result.exitCode
          }
          const executionStatus =
            result.returnReason === 'command_still_running'
              ? ('running' as const)
              : result.returnReason === 'command_stopped'
                ? ('cancelled' as const)
                : ('completed' as const)
          const payload = { ...publicResult, executionStatus, output: guarded.output }
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
          if (!terminalId) {
            const terminals = input.sessionManager
              .list({ chatSessionId: input.sessionId, workspaceId: input.workspaceId })
              .map((snapshot) => ({
                terminalId: snapshot.terminalId,
                status: snapshot.status,
                currentPath: snapshot.currentTerminalPath,
                currentCommand: snapshot.currentCommand
              }))
            session.succeed(
              undefined,
              buildTerminalToolResult({
                toolName: TERMINAL_READ_TOOL_SPEC.name,
                ok: true,
                data: terminals
              })
            )
            return terminals
          }
          try {
            const result = input.sessionManager.read({
              terminalId,
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
            const payload = {
              terminalId: result.terminalId,
              terminalStatus: result.terminalStatus,
              output: guarded.output,
              outputCursor: result.outputCursor,
              exitCode: result.exitCode
            }
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
