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
  buildWorkspaceTools: (input) => buildPdfCapabilityTools(input).tools
})
