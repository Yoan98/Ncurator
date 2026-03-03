import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { emitActivity } from '../../../../utils/aiCapabilityUtils'
import type { CapabilityToolFamily } from '../types'
import { buildDocxCapabilityTools } from './docxTools'

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

const createWorkspaceGuardTool = (input: {
  name: 'docx_inspect' | 'docx_apply_edits' | 'docx_save_output'
  runId: string
  taskId: string
  ctx: Parameters<CapabilityToolFamily['buildTools']>[0]['ctx']
}) => {
  return tool(
    async () => {
      input.ctx.sendEvent({
        type: 'workspace_required',
        runId: input.runId,
        taskId: input.taskId,
        reason: 'docx capability requires workspace binding before execution',
        requiredFields: ['workspaceId', 'rootPath'],
        createdAt: Date.now(),
        stage: 'human_tool_exec'
      })
      return {
        ok: false,
        code: 'workspace_required' as const,
        error: 'workspace is required for docx capability'
      }
    },
    {
      name: input.name,
      description: `docx tool: ${input.name}`,
      schema: z.record(z.string(), jsonValueSchema).optional()
    }
  )
}

export const docxCapability: CapabilityToolFamily = {
  capability: 'docx',
  buildTools: ({ ctx, runId, taskId }) => {
    const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
    if (!workspaceRootPath) {
      return [
        createWorkspaceGuardTool({ name: 'docx_inspect', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_apply_edits', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_save_output', runId, taskId, ctx })
      ]
    }

    const built = buildDocxCapabilityTools({
      ctx,
      runId,
      taskId,
      workspaceRootPath,
      safePreviewChars: 1400,
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

    return built.tools.filter(
      (toolItem) =>
        toolItem.name === 'docx_inspect' ||
        toolItem.name === 'docx_apply_edits' ||
        toolItem.name === 'docx_save_output'
    )
  }
}
