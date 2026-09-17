import os from 'node:os'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTerminalCapabilityTools } from './terminalTools'
import { terminalSessionManager } from './TerminalSessionManager'

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
      partnerId,
      taskId,
      workspaceRootPath: os.homedir(),
      workspaceId: '',
      sessionManager: terminalSessionManager,
      emitActivity
    }).tools
})
