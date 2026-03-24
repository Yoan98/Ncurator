import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { IpcJsonObject, IpcJsonValue } from '../../../../../../shared/types'
import { TERMINAL_RUN_COMMAND_CONTRACT } from '../catalog/toolDescriptors/terminal'
import { runTerminalCommand } from './terminalExec'
import { checkWorkspaceBoundary, classifyCommandRisk } from './terminalPolicy'
import type { TerminalCapabilityToolsInput, TerminalCapabilityToolsRuntimeState } from './types'
import { clipText, clipTextWithMeta } from '../../../utils/text'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { mergeArtifactCandidates, recordTerminalArtifacts } from './terminalArtifacts'
import { resolveTerminalCwd } from './terminalCwd'
import {
  buildTerminalFailure,
  buildTerminalStepError,
  emitTerminalStepCompletion,
  emitTerminalStepStarted,
  requestTerminalCommandApproval
} from './terminalRunHelpers'

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
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: 'terminal_run_command',
        args: args as IpcJsonObject,
        execute: async (session) => {
          input.ctx.checkCancelled()
          const command = String(args.command || '').trim()
          if (!command) {
            const emptyResult = buildTerminalFailure({
              code: 'invalid_input',
              error: 'empty command'
            })
            session.fail(emptyResult, emptyResult.error)
            return emptyResult
          }

          const cwdResult = resolveTerminalCwd({
            workspaceRootPath: input.workspaceRootPath,
            requestedCwd: args.cwd
          })
          if (!cwdResult.ok) {
            const cwdError = buildTerminalFailure({
              code: cwdResult.code,
              error: cwdResult.error
            })
            session.fail(cwdError, cwdError.error)
            return cwdError
          }
          const cwd = cwdResult.cwd

          const boundary = checkWorkspaceBoundary(command, input.workspaceRootPath)
          if (!boundary.ok) {
            const boundaryError = buildTerminalFailure({
              code: 'workspace_required',
              error: `workspace boundary check failed: ${boundary.reason}`
            })
            session.fail(boundaryError, boundaryError.error)
            return boundaryError
          }

          const riskLevel = classifyCommandRisk(command)
          if (riskLevel !== 'low') {
            const approval = await requestTerminalCommandApproval({
              ctx: input.ctx,
              runId: input.runId,
              taskId: input.taskId,
              command,
              riskLevel
            })
            if (!approval.approved) {
              const denied = buildTerminalFailure({
                code: 'approval_denied',
                error: approval.error
              })
              session.fail(denied, denied.error)
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
            truncated: result.truncated || preview.truncated,
            stepError,
            emitActivity: input.emitActivity
          })

          const artifacts = recordTerminalArtifacts({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId,
            stepId,
            candidates: artifactCandidates,
            emitActivity: input.emitActivity
          })

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
          if (stepError) {
            session.fail(output as IpcJsonValue, stepError)
          } else {
            session.succeed(output as IpcJsonValue)
          }
          return output
        },
        onError: (error, session) => {
          session.fail({ ok: false, code: 'failed', error: error.message } as IpcJsonValue, error.message)
        }
      }),
    {
      name: TERMINAL_RUN_COMMAND_CONTRACT.name,
      description:
        'Execute one shell command inside workspace with boundary checks, risk classification, approval gating, and terminal-step events.',
      schema: TERMINAL_RUN_COMMAND_CONTRACT.schema
    }
  )

  return {
    tools: [terminalRunCommand],
    state
  }
}
