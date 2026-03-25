import type { ToolFamilyDefinition } from '../types'
import { buildKbCapabilityTools } from './retrievalTools'

export const kbToolFamily: ToolFamilyDefinition = {
  familyId: 'kb',
  buildTools: ({ ctx, runId, taskId }) => buildKbCapabilityTools({ ctx, runId, taskId })
}
