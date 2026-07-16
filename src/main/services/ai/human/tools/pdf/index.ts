import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createPdfToolRuntime } from './runtime'
import { buildPdfReadTools } from './tools/readTools'

export const buildPdfCapabilityTools = (input: Parameters<typeof createPdfToolRuntime>[0]) => {
  const runtime = createPdfToolRuntime(input)
  input.cache.pdfRuntime = runtime
  return { tools: buildPdfReadTools(runtime), runtime }
}

export const pdfToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'pdf',
  descriptionForTool: (name) => `pdf tool: ${name}`,
  reason: 'pdf capability requires workspace binding before execution',
  error: 'workspace is required for pdf capability',
  buildWorkspaceTools: (input) => {
    return buildPdfCapabilityTools({
      ...input,
      safePreviewChars: 1400,
      modelContextWindowTokens:
        input.ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
        DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    }).tools
  }
})
