import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTerminalCapabilityTools } from './terminalTools'
import { terminalSessionManager } from './TerminalSessionManager'

export const terminalToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'terminal',
  buildWorkspaceTools: ({
    ctx,
    cache,
    runId,
    sessionId,
    taskId,
    workspaceRootPath,
    emitActivity
  }) =>
    buildTerminalCapabilityTools({
      ctx: {
        runId: ctx.runId,
        platform: ctx.platform,
        checkCancelled: ctx.checkCancelled,
        humanRuntimeOverrides: ctx.humanRuntimeOverrides,
        sendEvent: ctx.sendEvent,
        requestApprovalBatch: ctx.requestApprovalBatch,
        saveFileChangeRecord: ctx.saveFileChangeRecord,
        beginTerminalCommandTracking: ctx.beginTerminalCommandTracking,
        finishTerminalCommandTracking: ctx.finishTerminalCommandTracking,
        discardTerminalCommandTracking: ctx.discardTerminalCommandTracking
      },
      cache,
      runId,
      sessionId,
      taskId,
      workspaceRootPath,
      workspaceId: ctx.workspace?.workspaceId || '',
      sessionManager: terminalSessionManager,
      emitActivity
    }).tools
})
