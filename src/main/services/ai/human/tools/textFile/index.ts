import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { buildTextFileCapabilityTools } from './textFileTools'

export const textFileToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'text-file',
  buildWorkspaceTools: (input) => buildTextFileCapabilityTools(input).tools
})

export { buildTextFileCapabilityTools } from './textFileTools'
