import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import { jsonObjectSchema } from '../../schema'
import type { ToolFamilyDefinition } from '../types'
import { listToolNamesByFamily } from '../toolCatalog'
import { buildWorkspaceBoundGuardedTools } from '../utils/workspaceGuards'
import { buildTerminalCapabilityTools } from './terminalTools'

export const terminalToolFamily: ToolFamilyDefinition = {
  familyId: 'terminal',
  buildTools: ({ ctx, runId, taskId }) => {
    const terminalToolNames = listToolNamesByFamily('terminal')
    return buildWorkspaceBoundGuardedTools({
      toolNames: terminalToolNames,
      workspaceRootPath: ctx.workspace?.rootPath,
      descriptionForTool: () => 'Execute one shell command inside workspace.',
      schema: jsonObjectSchema.optional(),
      ctx,
      runId,
      taskId,
      reason: 'terminal_exec requires workspace binding before execution',
      error: 'workspace is required for terminal_exec',
      buildWorkspaceTools: (workspaceRootPath) =>
        buildTerminalCapabilityTools({
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
        }).tools
    })
  }
}
