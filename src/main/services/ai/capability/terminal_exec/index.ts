import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { emitActivity } from '../../../../utils/aiCapabilityUtils'
import type { CapabilityToolFamily } from '../types'
import { buildTerminalCapabilityTools } from './tools/terminalTools'

const jsonValueSchema = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

const workspaceRequiredResult = {
  ok: false,
  code: 'workspace_required',
  error: 'workspace is required for terminal_exec'
}

export const terminalExecCapability: CapabilityToolFamily = {
  capability: 'terminal_exec',
  buildTools: ({ ctx, runId, taskId }) => {
    const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
    if (!workspaceRootPath) {
      return [
        tool(
          async () => {
            ctx.sendEvent({
              type: 'workspace_required',
              runId,
              taskId,
              reason: 'terminal_exec requires workspace binding before execution',
              requiredFields: ['workspaceId', 'rootPath'],
              createdAt: Date.now(),
              stage: 'human_tool_exec'
            })
            return workspaceRequiredResult
          },
          {
            name: 'terminal_run_command',
            description: 'Execute one shell command inside workspace.',
            schema: z
              .object({
                command: z.string().optional(),
                cwd: z.string().optional(),
                expectedArtifacts: z.array(z.record(z.string(), jsonValueSchema)).optional()
              })
              .passthrough()
          }
        )
      ]
    }

    const built = buildTerminalCapabilityTools({
      ctx,
      runId,
      taskId,
      workspaceRootPath,
      timeoutMs: 15000,
      maxOutputChars: 8000,
      safePreviewChars: 600,
      emitActivity: (activity) => {
        emitActivity({
          ctx,
          runId,
          taskId,
          actionType: activity.actionType,
          status: activity.status,
          summary: activity.summary
        })
      }
    })

    return built.tools.filter((toolItem) => toolItem.name === 'terminal_run_command')
  }
}
