import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import { jsonObjectSchema } from '../../schema'
import type { ToolFamilyDefinition } from '../types'
import { listToolNamesByFamily } from '../toolCatalog'
import { createWorkspaceRequiredGuardTool } from '../utils/workspaceGuards'
import { buildDocxCapabilityTools } from './docxTools'

export const docxToolFamily: ToolFamilyDefinition = {
  familyId: 'docx',
  buildTools: ({ ctx, runId, taskId }) => {
    const docxToolNames = listToolNamesByFamily('docx')
    const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
    if (!workspaceRootPath) {
      return docxToolNames.map((name) =>
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

    const docxToolNameSet = new Set(docxToolNames)
    return built.tools.filter((toolItem) => docxToolNameSet.has(String(toolItem.name || '').trim()))
  }
}
