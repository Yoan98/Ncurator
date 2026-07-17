import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTextFileCapabilityTools } from './textFileTools'

export const textFileToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'text-file',
  descriptionForTool: (toolName) =>
    toolName === 'text_file_read' ? 'Read a UTF-8 text file.' : 'Write a UTF-8 text file.',
  reason: 'text file tools require workspace binding before execution',
  error: 'workspace is required for text file tools',
  buildWorkspaceTools: (input) => buildTextFileCapabilityTools(input).tools
})

export { buildTextFileCapabilityTools } from './textFileTools'
