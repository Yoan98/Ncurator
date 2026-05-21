import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import type { DocxCapabilityToolsInput } from './types'
import { createDocxToolRuntime } from './runtime'
import { buildDocxReadTools } from './tools/readTools'
import { buildDocxWriteTools } from './tools/writeTools'

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const runtime = createDocxToolRuntime(input)
  input.cache.docxRuntime = runtime

  return {
    tools: [...buildDocxReadTools(runtime), ...buildDocxWriteTools(runtime)],
    state: runtime.state,
    runtime
  }
}

export const docxToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'docx',
  descriptionForTool: (name) => `docx tool: ${name}`,
  reason: 'docx capability requires workspace binding before execution',
  error: 'workspace is required for docx capability',
  buildWorkspaceTools: ({ ctx, cache, runId, taskId, workspaceRootPath, emitActivity }) =>
    buildDocxCapabilityTools({
      ctx: {
        runId: ctx.runId,
        checkCancelled: ctx.checkCancelled,
        sendEvent: ctx.sendEvent,
        trackDocxOpen: ctx.trackDocxOpen,
        trackDocxChanges: ctx.trackDocxChanges,
        resolveDocxOpenTarget: ctx.resolveDocxOpenTarget,
        embeddingService: ctx.embeddingService
      },
      cache,
      runId,
      taskId,
      workspaceRootPath,
      emitActivity,
      safePreviewChars: 1400,
      modelContextWindowTokens:
        ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
        DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    }).tools
})
