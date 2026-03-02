import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type {
  AiFileArtifactOperation,
  AiTaskResultCode,
  IpcJsonObject,
  IpcJsonValue
} from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { runTerminalCommand } from './terminalExec'
import {
  checkWorkspaceBoundary,
  classifyCommandRisk,
  collectTerminalArtifactCandidates,
  resolveWorkspacePath
} from './terminalPolicy'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'

type EmitActivityInput = {
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}

type TerminalCapabilityToolsInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
  workspaceRootPath: string
  timeoutMs: number
  maxOutputChars: number
  safePreviewChars: number
  emitActivity: (input: EmitActivityInput) => void
}

export type TerminalToolFinishState = {
  done: boolean
  success: boolean
  summary?: string
  resultCode?: AiTaskResultCode
}

export type TerminalCapabilityToolsRuntimeState = {
  /** 已执行命令的步数，用于事件 stepIndex 与回合统计。 */
  stepIndex: number
  /** terminal_finish 调用后写入的完成态。 */
  finish: TerminalToolFinishState
}

type ArtifactCandidate = {
  resolvedPath: string
  summary: string
  requestedOperation?: AiFileArtifactOperation
  existedBefore: boolean
}

const clipText = (text: string, maxChars: number) => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return { text: raw, truncated: false }
  return { text: raw.slice(0, maxChars), truncated: true }
}

const artifactHintSchema = z.object({
  path: z.string(),
  operation: z.enum(['created', 'updated']).optional(),
  summary: z.string().optional()
})

const terminalRunCommandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  expectedArtifacts: z.array(artifactHintSchema).optional()
})

const terminalFinishSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  resultCode: z
    .enum(['ok', 'failed', 'approval_denied', 'bounded_loop_error', 'invalid_input'])
    .optional()
})

const mergeArtifactCandidates = (input: {
  command: string
  expectedArtifacts: Array<{ path: string; operation?: AiFileArtifactOperation; summary?: string }>
  cwd: string
  workspaceRootPath: string
}): ArtifactCandidate[] => {
  const merged = new Map<
    string,
    { requestedOperation?: AiFileArtifactOperation; summary?: string }
  >()

  const commandCandidates = collectTerminalArtifactCandidates(input.command).map((item) => ({
    path: item.rawPath,
    operation: item.operation,
    summary: undefined
  }))
  const explicitCandidates = input.expectedArtifacts.map((item) => ({
    path: item.path,
    operation: item.operation,
    summary: item.summary
  }))

  for (const item of [...commandCandidates, ...explicitCandidates]) {
    const resolved = resolveWorkspacePath({
      rawPath: item.path,
      cwd: input.cwd,
      rootPath: input.workspaceRootPath
    })
    if (!resolved) continue
    const prev = merged.get(resolved)
    if (!prev) {
      merged.set(resolved, {
        requestedOperation: item.operation,
        summary: item.summary
      })
      continue
    }
    merged.set(resolved, {
      requestedOperation: prev.requestedOperation || item.operation,
      summary: prev.summary || item.summary
    })
  }

  return Array.from(merged.entries()).map(([resolvedPath, meta]) => ({
    resolvedPath,
    summary:
      meta.summary || `terminal command produced/updated file: ${path.basename(resolvedPath)}`,
    requestedOperation: meta.requestedOperation,
    existedBefore: fs.existsSync(resolvedPath)
  }))
}

const resolveCwd = (input: { workspaceRootPath: string; requestedCwd?: string }): string | null => {
  const root = path.resolve(input.workspaceRootPath)
  const requested = String(input.requestedCwd || '').trim()
  if (!requested) return root
  return resolveWorkspacePath({
    rawPath: requested,
    cwd: root,
    rootPath: root
  })
}

export const buildTerminalCapabilityTools = (input: TerminalCapabilityToolsInput) => {
  const state: TerminalCapabilityToolsRuntimeState = {
    stepIndex: 0,
    finish: {
      done: false,
      success: false
    }
  }

  const emitStarted = (toolName: string, args: IpcJsonObject) => {
    const toolCallId = randomUUID()
    input.ctx.sendEvent({
      type: 'tool_call_started',
      runId: input.runId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      input: args,
      createdAt: Date.now()
    })
    return toolCallId
  }

  const emitResult = (
    toolName: string,
    toolCallId: string,
    outputPreview: IpcJsonValue,
    error?: string
  ) => {
    input.ctx.sendEvent({
      type: 'tool_call_result',
      runId: input.runId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      outputPreview,
      completedAt: Date.now(),
      error
    })
  }

  const terminalRunCommand = tool(
    async (args) => {
      const toolName = 'terminal_run_command'
      const toolCallId = emitStarted(toolName, args)

      try {
        input.ctx.checkCancelled()
        const command = String(args.command || '').trim()
        if (!command) {
          const emptyResult = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'empty command'
          }
          emitResult(toolName, toolCallId, emptyResult, emptyResult.error)
          return emptyResult
        }

        const cwd = resolveCwd({
          workspaceRootPath: input.workspaceRootPath,
          requestedCwd: args.cwd
        })
        if (!cwd) {
          const cwdError = {
            ok: false,
            code: 'workspace_required' as const,
            error: 'cwd is out of workspace boundary'
          }
          emitResult(toolName, toolCallId, cwdError, cwdError.error)
          return cwdError
        }

        const boundary = checkWorkspaceBoundary(command, input.workspaceRootPath)
        if (!boundary.ok) {
          const boundaryError = {
            ok: false,
            code: 'workspace_required' as const,
            error: `workspace boundary check failed: ${boundary.reason}`
          }
          emitResult(toolName, toolCallId, boundaryError, boundaryError.error)
          return boundaryError
        }

        const riskLevel = classifyCommandRisk(command)
        if (riskLevel !== 'low') {
          const decision = await input.ctx.requestApproval({
            runId: input.runId,
            taskId: input.taskId,
            command,
            riskLevel,
            reason: `command classified as ${riskLevel} risk`
          })
          if (!decision.approved) {
            const denied = {
              ok: false,
              code: 'approval_denied' as const,
              error: decision.reason || 'approval denied'
            }
            emitResult(toolName, toolCallId, denied, denied.error)
            return denied
          }
        }

        const artifactCandidates = mergeArtifactCandidates({
          command,
          expectedArtifacts: Array.isArray(args.expectedArtifacts) ? args.expectedArtifacts : [],
          cwd,
          workspaceRootPath: input.workspaceRootPath
        })

        state.stepIndex += 1
        const stepId = randomUUID()
        input.ctx.sendEvent({
          type: 'terminal_step_started',
          runId: input.runId,
          taskId: input.taskId,
          stepId,
          stepIndex: state.stepIndex,
          command,
          cwd,
          createdAt: Date.now()
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
        const preview = clipText(previewSource || '(no output)', input.safePreviewChars)
        const stepError =
          result.timedOut || result.exitCode !== 0
            ? result.timedOut
              ? `command timed out after ${input.timeoutMs}ms`
              : `command exited with code ${String(result.exitCode)}`
            : undefined

        if (stepError) {
          input.ctx.sendEvent({
            type: 'terminal_step_error',
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            stepIndex: state.stepIndex,
            command,
            error: stepError,
            outputPreview: preview.text,
            completedAt: Date.now()
          })
          input.emitActivity({
            actionType: 'terminal_exec',
            status: 'failed',
            summary: `${command} -> ${stepError}`
          })
        } else {
          input.ctx.sendEvent({
            type: 'terminal_step_result',
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            stepIndex: state.stepIndex,
            command,
            outputPreview: preview.text,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            truncated: result.truncated || preview.truncated,
            completedAt: Date.now()
          })
          input.emitActivity({
            actionType: 'terminal_exec',
            status: 'completed',
            summary: `${command} -> success`
          })
        }

        const artifacts: Array<{ path: string; operation: AiFileArtifactOperation }> = []
        for (const artifact of artifactCandidates) {
          if (!fs.existsSync(artifact.resolvedPath)) continue
          const operation =
            artifact.requestedOperation || (artifact.existedBefore ? 'updated' : 'created')
          const emitted = emitFileArtifactEvent({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            capability: 'terminal_exec',
            artifactPath: artifact.resolvedPath,
            operation,
            summary: artifact.summary,
            stepId,
            onNonFatalError: (reason) => {
              input.emitActivity({
                actionType: 'file_artifact',
                status: 'failed',
                summary: reason
              })
            }
          })
          if (emitted) {
            artifacts.push({
              path: artifact.resolvedPath,
              operation
            })
          }
        }

        const output = {
          ok: !stepError,
          code: stepError ? ('failed' as const) : ('ok' as const),
          command,
          cwd,
          stepId,
          stepIndex: state.stepIndex,
          outputPreview: preview.text,
          stdoutPreview: clipText(result.stdout, input.safePreviewChars).text,
          stderrPreview: clipText(result.stderr, input.safePreviewChars).text,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          truncated: result.truncated || preview.truncated,
          artifacts,
          error: stepError
        }
        emitResult(toolName, toolCallId, output, stepError)
        return output
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        emitResult(toolName, toolCallId, { ok: false, code: 'failed', error: msg }, msg)
        throw error
      }
    },
    {
      name: 'terminal_run_command',
      description:
        'Execute one shell command inside workspace with boundary checks, risk classification, approval gating, and terminal-step events.',
      schema: terminalRunCommandSchema
    }
  )

  const terminalFinish = tool(
    async (args) => {
      const toolName = 'terminal_finish'
      const toolCallId = emitStarted(toolName, args)
      const summary = String(args.summary || '').trim()
      state.finish = {
        done: true,
        success: Boolean(args.success),
        summary: summary || undefined,
        resultCode: args.resultCode
      }
      const result = {
        done: true,
        success: state.finish.success,
        summary: state.finish.summary,
        resultCode: state.finish.resultCode
      }
      emitResult(toolName, toolCallId, result)
      return result
    },
    {
      name: 'terminal_finish',
      description:
        'Mark terminal capability as finished. Must be called when objective is completed or cannot continue safely.',
      schema: terminalFinishSchema
    }
  )

  return {
    tools: [terminalRunCommand, terminalFinish],
    state
  }
}
