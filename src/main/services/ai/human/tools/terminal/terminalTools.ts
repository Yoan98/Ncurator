import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { AiFileArtifactOperation, IpcJsonObject, IpcJsonValue } from '../../../../../../shared/types'
import { runTerminalCommand } from './terminalExec'
import {
  checkWorkspaceBoundary,
  classifyCommandRisk,
  collectTerminalArtifactCandidates,
  resolveWorkspacePath
} from './terminalPolicy'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type {
  ArtifactCandidate,
  ResolvedCwd,
  TerminalCapabilityToolsInput,
  TerminalCapabilityToolsRuntimeState
} from './types'
import { clipText, clipTextWithMeta } from '../../../utils/text'
import { createToolEventEmitter } from '../utils/toolEvents'

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

const resolveCwd = (input: {
  workspaceRootPath: string
  requestedCwd?: string
}): ResolvedCwd => {
  const root = path.resolve(input.workspaceRootPath)
  const requestedRaw = String(input.requestedCwd || '').trim()
  if (!requestedRaw) {
    return {
      ok: true,
      cwd: root
    }
  }

  const normalizedRequested = requestedRaw.replace(/[\\/]+$/g, '')
  const rootAlias = path.basename(root).replace(/[\\/]+$/g, '')
  const requested =
    normalizedRequested === rootAlias || normalizedRequested === path.join('.', rootAlias)
      ? '.'
      : requestedRaw

  const resolved = resolveWorkspacePath({
    rawPath: requested,
    cwd: root,
    rootPath: root
  })
  if (!resolved) {
    return {
      ok: false,
      code: 'workspace_required',
      error: 'cwd is out of workspace boundary'
    }
  }
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      code: 'invalid_input',
      error: 'cwd does not exist inside workspace'
    }
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return {
      ok: false,
      code: 'invalid_input',
      error: 'cwd is not a directory'
    }
  }

  return {
    ok: true,
    cwd: resolved
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
    async (args) => {
      const toolName = 'terminal_run_command'
      const toolCallId = toolEvents.emitStarted(toolName, args as IpcJsonObject)

      try {
        input.ctx.checkCancelled()
        const command = String(args.command || '').trim()
        if (!command) {
          const emptyResult = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'empty command'
          }
          toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: emptyResult,
            error: emptyResult.error
          })
          return emptyResult
        }

        const cwdResult = resolveCwd({
          workspaceRootPath: input.workspaceRootPath,
          requestedCwd: args.cwd
        })
        if (!cwdResult.ok) {
          const cwdError = {
            ok: false,
            code: cwdResult.code,
            error: cwdResult.error
          }
          toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: cwdError,
            error: cwdError.error
          })
          return cwdError
        }
        const cwd = cwdResult.cwd

        const boundary = checkWorkspaceBoundary(command, input.workspaceRootPath)
        if (!boundary.ok) {
          const boundaryError = {
            ok: false,
            code: 'workspace_required' as const,
            error: `workspace boundary check failed: ${boundary.reason}`
          }
          toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: boundaryError,
            error: boundaryError.error
          })
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
            toolEvents.emitResult({
              toolName,
              toolCallId,
              outputPreview: denied,
              error: denied.error
            })
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
        const preview = clipTextWithMeta(previewSource || '(no output)', input.safePreviewChars)
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
          stdoutPreview: clipText(result.stdout, input.safePreviewChars),
          stderrPreview: clipText(result.stderr, input.safePreviewChars),
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          truncated: result.truncated || preview.truncated,
          artifacts,
          error: stepError
        }
        toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: output,
          error: stepError
        })
        return output
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: { ok: false, code: 'failed', error: msg } as IpcJsonValue,
          error: msg
        })
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

  return {
    tools: [terminalRunCommand],
    state
  }
}
