import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTerminalCapabilityTools } from './terminalTools'
import { terminalSessionManager } from './TerminalSessionManager'
import { getTerminalStartDirectory } from './workingDirectory'

export const terminalToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'terminal',
  buildWorkspaceTools: ({ ctx, cache, runId, partnerId, taskId, emitActivity }) =>
    buildTerminalCapabilityTools({
      ctx: {
        runId: ctx.runId,
        platform: ctx.platform,
        checkCancelled: ctx.checkCancelled,
        humanRuntimeOverrides: ctx.humanRuntimeOverrides,
        sendEvent: ctx.sendEvent
      },
      cache,
      runId,
      partnerId: ctx.isSubagent ? runId : partnerId,
      taskId,
      workspaceRootPath: getTerminalStartDirectory(),
      workspaceId: '',
      sessionManager: terminalSessionManager,
      emitActivity
    }).tools
})
