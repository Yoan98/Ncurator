import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import { jsonObjectSchema } from '../../schema'
import type { ToolFamilyDefinition } from '../types'
import { createWorkspaceRequiredGuardTool } from '../utils/workspaceGuards'
import { buildDocxCapabilityTools } from './docxTools'

const DOCX_TOOL_NAMES = [
  'docx_open',
  'docx_outline',
  'docx_get_block',
  'docx_search',
  'docx_apply_ops',
  'docx_get_history',
  'docx_rollback',
  'docx_save',
  'docx_render_preview',
  'docx_validate'
] as const

export const docxToolFamily: ToolFamilyDefinition = {
  familyId: 'docx',
  buildTools: ({ ctx, runId, taskId }) => {
    const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
    if (!workspaceRootPath) {
      return DOCX_TOOL_NAMES.map((name) =>
        createWorkspaceRequiredGuardTool({
          name,
          description: `docx tool: ${name}`,
          schema: jsonObjectSchema.optional(),
          ctx,
          runId,
          taskId,
          reason: 'docx capability requires workspace binding before execution',
          error: 'workspace is required for docx capability'
        })
      )
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
        toolItem.name === 'docx_save' ||
        toolItem.name === 'docx_render_preview' ||
        toolItem.name === 'docx_validate'
    )
  }
}
