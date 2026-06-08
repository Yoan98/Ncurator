import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO } from '../../constants'
import { buildTerminalCapabilityTools } from './terminalTools'

export const terminalToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'terminal',
  descriptionForTool: () => 'Execute one shell command inside workspace.',
  reason: 'terminal_exec requires workspace binding before execution',
  error: 'workspace is required for terminal_exec',
  buildWorkspaceTools: ({ ctx, cache, runId, sessionId, taskId, workspaceRootPath, emitActivity }) =>
    buildTerminalCapabilityTools({
      ctx: {
        runId: ctx.runId,
        platform: ctx.platform,
        checkCancelled: ctx.checkCancelled,
        sendEvent: ctx.sendEvent,
        requestApprovalBatch: ctx.requestApprovalBatch,
        saveFileChangeRecord: ctx.saveFileChangeRecord
      },
      cache,
      runId,
      sessionId,
      taskId,
      workspaceRootPath,
      emitActivity,
      timeoutMs: 15000,
      captureHardLimitChars: 120_000,
      aiResultTokenLimitRatio: HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO
    }).tools
})
