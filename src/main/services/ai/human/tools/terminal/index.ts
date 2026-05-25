import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTerminalCapabilityTools } from './terminalTools'

export const terminalToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'terminal',
  descriptionForTool: () => 'Execute one shell command inside workspace.',
  reason: 'terminal_exec requires workspace binding before execution',
  error: 'workspace is required for terminal_exec',
  buildWorkspaceTools: ({ ctx, cache, runId, taskId, workspaceRootPath, emitActivity }) =>
    buildTerminalCapabilityTools({
      ctx: {
        runId: ctx.runId,
        checkCancelled: ctx.checkCancelled,
        sendEvent: ctx.sendEvent,
        requestApprovalBatch: ctx.requestApprovalBatch
      },
      cache,
      runId,
      taskId,
      workspaceRootPath,
      emitActivity,
      timeoutMs: 15000,
      captureHardLimitChars: 120_000,
      aiResultTokenLimitRatio: 0.1
    }).tools
})
