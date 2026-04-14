import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import type { DocxCapabilityToolsInput } from './types'
import { createDocxToolRuntime } from './runtime'
import { buildDocxReadTools } from './tools/readTools'
import { buildDocxWriteTools } from './tools/writeTools'

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const runtime = createDocxToolRuntime(input)

  return {
    tools: [...buildDocxReadTools(runtime), ...buildDocxWriteTools(runtime)],
    state: runtime.state
  }
}

export const docxToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'docx',
  descriptionForTool: (name) => `docx tool: ${name}`,
  reason: 'docx capability requires workspace binding before execution',
  error: 'workspace is required for docx capability',
  buildWorkspaceTools: ({ ctx, runId, taskId, workspaceRootPath, emitActivity }) =>
    buildDocxCapabilityTools({
      ctx: {
        runId: ctx.runId,
        checkCancelled: ctx.checkCancelled,
        sendEvent: ctx.sendEvent,
        requestApproval: ctx.requestApproval,
        trackDocxOpen: ctx.trackDocxOpen,
        trackDocxChanges: ctx.trackDocxChanges,
        resolveDocxOpenTarget: ctx.resolveDocxOpenTarget,
        embeddingService: ctx.embeddingService
      },
      runId,
      taskId,
      workspaceRootPath,
      emitActivity,
      safePreviewChars: 1400
    }).tools
})
