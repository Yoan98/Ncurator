import { localKbRetrievalCapability } from '../local_kb_retrieval'

const KB_EVIDENCE_TOOL_NAMES = new Set([
  'kb_hybrid_search_chunks',
  'kb_vector_search_chunks',
  'kb_fts_search_chunks'
])

export const buildKbEvidenceQueryTools = (
  input: Parameters<typeof localKbRetrievalCapability.buildTools>[0]
) =>
  localKbRetrievalCapability
    .buildTools(input)
    .filter((tool) => KB_EVIDENCE_TOOL_NAMES.has(String(tool.name || '')))
