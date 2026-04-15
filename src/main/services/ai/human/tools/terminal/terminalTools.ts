import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  AiToolCallResult,
  JsonObject,
  IpcJsonObject
} from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import { clipText, clipTextWithMeta } from '../../../utils/text'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { CapabilityActivityInput } from '../types'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import { analyzeTerminalCommand, checkWorkspaceBoundary } from './terminalCommandPolicy'
import { resolveTerminalCwd, resolveWorkspacePath } from './terminalCwd'
import { runTerminalCommand } from './terminalExec'
import type {
  TerminalCapabilityToolsInput,
  TerminalCapabilityToolsRuntimeState,
  TerminalCommandApprovalRiskLevel
} from './types'
import {
  WORKSPACE_LIST_FILES_SCHEMA,
  WORKSPACE_LIST_FILES_TOOL_SPEC,
  WORKSPACE_READ_FILE_SCHEMA,
  WORKSPACE_READ_FILE_TOOL_SPEC,
  WORKSPACE_RUN_COMMAND_SCHEMA,
  WORKSPACE_RUN_COMMAND_TOOL_SPEC,
  WORKSPACE_SEARCH_TEXT_SCHEMA,
  WORKSPACE_SEARCH_TEXT_TOOL_SPEC
} from './toolSpecs'

const MAX_FILE_READ_CHARS = 12000
const DEFAULT_LIST_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 50

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

const shellEscape = (value: string): string => `'${String(value).replace(/'/g, `'\\''`)}'`

const createPathResolver = (workspaceRootPath: string) => (rawPath: string | undefined, cwd: string) => {
  if (!rawPath) return cwd
  return resolveWorkspacePath({
    rawPath,
    cwd,
    rootPath: workspaceRootPath
  })
}

const walkWorkspace = async (input: {
  rootPath: string
  limit: number
  filePattern?: string
}): Promise<Array<{ path: string; type: 'file' | 'directory' }>> => {
  const results: Array<{ path: string; type: 'file' | 'directory' }> = []
  const stack = [input.rootPath]
  const pattern = String(input.filePattern || '').trim()
  const matcher =
    pattern.length > 0
      ? new RegExp(
          `^${pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '___DOUBLE_STAR___')
            .replace(/\*/g, '[^/]*')
            .replace(/___DOUBLE_STAR___/g, '.*')}$`
        )
      : null

  while (stack.length > 0 && results.length < input.limit) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      const relativePath = path.relative(input.rootPath, absolutePath) || '.'
      if (entry.isDirectory()) {
        results.push({
          path: relativePath,
          type: 'directory'
        })
        if (results.length >= input.limit) break
        stack.push(absolutePath)
        continue
      }
      if (matcher && !matcher.test(relativePath)) continue
      results.push({
        path: relativePath,
        type: 'file'
      })
      if (results.length >= input.limit) break
    }
  }

  return results
}

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
  const resolvePath = createPathResolver(input.workspaceRootPath)

  const workspaceListFiles = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: WORKSPACE_LIST_FILES_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const cwdResult = resolveTerminalCwd({
            workspaceRootPath: input.workspaceRootPath,
            requestedCwd: args.path
          })
          if (!cwdResult.ok) {
            const failure = buildFailure({
              code: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(
              failure,
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: WORKSPACE_LIST_FILES_TOOL_SPEC.name,
                ok: false,
                code: failure.code,
                data: failure
              })
            )
            return failure
          }

          const items = await walkWorkspace({
            rootPath: cwdResult.cwd,
            limit: Math.max(1, Number(args.limit || DEFAULT_LIST_LIMIT)),
            filePattern: typeof args.filePattern === 'string' ? args.filePattern : undefined
          })
          const result = {
            ok: true as const,
            code: 'ok' as const,
            rootPath: cwdResult.cwd,
            items
          }
          session.succeed(
            items.slice(0, 5),
            undefined,
            buildTerminalToolResult({
              toolName: WORKSPACE_LIST_FILES_TOOL_SPEC.name,
              ok: true,
              code: 'ok',
              data: result
            })
          )
          return result
        }
      }),
    {
      name: WORKSPACE_LIST_FILES_TOOL_SPEC.name,
      description: WORKSPACE_LIST_FILES_TOOL_SPEC.promptSpec.purpose,
      schema: WORKSPACE_LIST_FILES_SCHEMA
    }
  )

  const workspaceSearchText = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: WORKSPACE_SEARCH_TEXT_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const cwdResult = resolveTerminalCwd({
            workspaceRootPath: input.workspaceRootPath,
            requestedCwd: args.path
          })
          if (!cwdResult.ok) {
            const failure = buildFailure({
              code: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(
              failure,
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: WORKSPACE_SEARCH_TEXT_TOOL_SPEC.name,
                ok: false,
                code: failure.code,
                data: failure
              })
            )
            return failure
          }

          const patternArg =
            typeof args.filePattern === 'string' && args.filePattern.trim()
              ? ` --glob ${shellEscape(args.filePattern.trim())}`
              : ''
          const command = `rg -n --no-heading --hidden${patternArg} -- ${shellEscape(String(args.query))} ${shellEscape(cwdResult.cwd)}`
          const rgResult = await runTerminalCommand({
            command,
            cwd: input.workspaceRootPath,
            timeoutMs: input.timeoutMs,
            maxOutputChars: input.maxOutputChars
          })
          const lines = rgResult.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, Math.max(1, Number(args.limit || DEFAULT_SEARCH_LIMIT)))
          const matches = lines.map((line) => {
            const firstColon = line.indexOf(':')
            const secondColon = line.indexOf(':', firstColon + 1)
            const filePath = firstColon >= 0 ? line.slice(0, firstColon) : line
            const lineNumber =
              firstColon >= 0 && secondColon > firstColon
                ? Number(line.slice(firstColon + 1, secondColon))
                : 0
            const text = secondColon > firstColon ? line.slice(secondColon + 1) : ''
            return {
              path: path.relative(input.workspaceRootPath, filePath),
              line: lineNumber,
              text
            }
          })
          const result = {
            ok: true as const,
            code: 'ok' as const,
            query: String(args.query),
            matches,
            truncated: lines.length >= Math.max(1, Number(args.limit || DEFAULT_SEARCH_LIMIT))
          }
          session.succeed(
            matches.slice(0, 5),
            undefined,
            buildTerminalToolResult({
              toolName: WORKSPACE_SEARCH_TEXT_TOOL_SPEC.name,
              ok: true,
              code: 'ok',
              data: result
            })
          )
          return result
        }
      }),
    {
      name: WORKSPACE_SEARCH_TEXT_TOOL_SPEC.name,
      description: WORKSPACE_SEARCH_TEXT_TOOL_SPEC.promptSpec.purpose,
      schema: WORKSPACE_SEARCH_TEXT_SCHEMA
    }
  )

  const workspaceReadFile = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: WORKSPACE_READ_FILE_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const resolvedPath = resolvePath(
            typeof args.path === 'string' ? args.path : undefined,
            input.workspaceRootPath
          )
          if (!resolvedPath) {
            const failure = buildFailure({
              code: 'workspace_required',
              error: 'path is out of workspace boundary'
            })
            session.fail(
              failure,
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: WORKSPACE_READ_FILE_TOOL_SPEC.name,
                ok: false,
                code: failure.code,
                data: failure
              })
            )
            return failure
          }

          const fileStat = await fs.stat(resolvedPath)
          if (!fileStat.isFile()) {
            const failure = buildFailure({
              code: 'invalid_input',
              error: 'path is not a file'
            })
            session.fail(
              failure,
              failure.error,
              undefined,
              buildTerminalToolResult({
                toolName: WORKSPACE_READ_FILE_TOOL_SPEC.name,
                ok: false,
                code: failure.code,
                data: failure
              })
            )
            return failure
          }

          const raw = await fs.readFile(resolvedPath, 'utf8')
          const lines = raw.split(/\r?\n/)
          const startLine = Math.max(1, Number(args.startLine || 1))
          const endLine = Math.max(startLine, Number(args.endLine || lines.length))
          const content = lines.slice(startLine - 1, endLine).join('\n')
          const clipped = clipText(content, MAX_FILE_READ_CHARS)
          const result = {
            ok: true as const,
            code: 'ok' as const,
            path: path.relative(input.workspaceRootPath, resolvedPath),
            startLine,
            endLine,
            truncated: clipped !== content,
            content: clipped
          }
          session.succeed(
            { path: result.path, startLine: result.startLine, endLine: result.endLine },
            undefined,
            buildTerminalToolResult({
              toolName: WORKSPACE_READ_FILE_TOOL_SPEC.name,
              ok: true,
              code: 'ok',
              data: result
            })
          )
          return result
        }
      }),
    {
      name: WORKSPACE_READ_FILE_TOOL_SPEC.name,
      description: WORKSPACE_READ_FILE_TOOL_SPEC.promptSpec.purpose,
      schema: WORKSPACE_READ_FILE_SCHEMA
    }
  )

  const workspaceRunCommand = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
                toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
                toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
                toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
                  toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
                toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
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
              toolName: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
              ok: true,
              code: 'ok',
              data: payload
            })
          )
          return payload
        }
      }),
    {
      name: WORKSPACE_RUN_COMMAND_TOOL_SPEC.name,
      description: WORKSPACE_RUN_COMMAND_TOOL_SPEC.promptSpec.purpose,
      schema: WORKSPACE_RUN_COMMAND_SCHEMA
    }
  )

  return {
    tools: [workspaceListFiles, workspaceSearchText, workspaceReadFile, workspaceRunCommand],
    state
  }
}
