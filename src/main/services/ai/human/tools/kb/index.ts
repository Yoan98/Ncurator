import type { ToolFamilyDefinition } from '../types'
import { buildRetrievalTools } from './retrievalTools'

export const kbToolFamily: ToolFamilyDefinition = {
  familyId: 'kb',
  buildTools: ({ ctx, runId, taskId }) => buildRetrievalTools({ ctx, runId, taskId })
}
