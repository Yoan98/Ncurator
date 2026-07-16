import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO } from '../../constants'
import { buildTerminalCapabilityTools } from './terminalTools'
import { terminalSessionManager } from './TerminalSessionManager'

export const terminalToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'terminal',
  descriptionForTool: () => 'Use a persistent terminal inside workspace.',
  reason: 'terminal_exec requires workspace binding before execution',
  error: 'workspace is required for terminal_exec',
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
        saveFileChangeRecord: ctx.saveFileChangeRecord
      },
      cache,
      runId,
      sessionId,
      taskId,
      workspaceRootPath,
      workspaceId: ctx.workspace?.workspaceId || '',
      sessionManager: terminalSessionManager,
      emitActivity,
      aiResultTokenLimitRatio: HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO
    }).tools
})
