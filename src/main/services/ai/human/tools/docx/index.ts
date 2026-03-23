import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import { jsonObjectSchema } from '../../schema'
import type { ToolFamilyDefinition } from '../types'
import { listToolNamesByFamily } from '../toolCatalog'
import { buildWorkspaceBoundGuardedTools } from '../utils/workspaceGuards'
import { buildDocxCapabilityTools } from './docxTools'

export const docxToolFamily: ToolFamilyDefinition = {
  familyId: 'docx',
  buildTools: ({ ctx, runId, taskId }) => {
    const docxToolNames = listToolNamesByFamily('docx')
    return buildWorkspaceBoundGuardedTools({
      toolNames: docxToolNames,
      workspaceRootPath: ctx.workspace?.rootPath,
      descriptionForTool: (name) => `docx tool: ${name}`,
      schema: jsonObjectSchema.optional(),
      ctx,
      runId,
      taskId,
      reason: 'docx capability requires workspace binding before execution',
      error: 'workspace is required for docx capability',
      buildWorkspaceTools: (workspaceRootPath) =>
        buildDocxCapabilityTools({
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
        }).tools
    })
  }
}
