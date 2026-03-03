import type { CapabilityToolFamily } from '../types'
import { buildRetrievalTools } from './tools/retrievalTools'

export const localKbRetrievalCapability: CapabilityToolFamily = {
  capability: 'local_kb_retrieval',
  buildTools: ({ ctx, runId, taskId }) => buildRetrievalTools({ ctx, runId, taskId })
}
