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
  name:
    | 'docx_open'
    | 'docx_outline'
    | 'docx_get_block'
    | 'docx_search'
    | 'docx_apply_ops'
    | 'docx_get_history'
    | 'docx_rollback'
    | 'docx_render_preview'
    | 'docx_save'
    | 'docx_validate'
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
        createWorkspaceGuardTool({ name: 'docx_open', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_outline', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_get_block', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_search', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_apply_ops', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_get_history', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_rollback', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_render_preview', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_save', runId, taskId, ctx }),
        createWorkspaceGuardTool({ name: 'docx_validate', runId, taskId, ctx })
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
        toolItem.name === 'docx_open' ||
        toolItem.name === 'docx_outline' ||
        toolItem.name === 'docx_get_block' ||
        toolItem.name === 'docx_search' ||
        toolItem.name === 'docx_apply_ops' ||
        toolItem.name === 'docx_get_history' ||
        toolItem.name === 'docx_rollback' ||
        toolItem.name === 'docx_render_preview' ||
        toolItem.name === 'docx_save' ||
        toolItem.name === 'docx_validate'
    )
  }
}
