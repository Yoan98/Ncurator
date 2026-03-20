import { localKbRetrievalCapability } from '../local_kb_retrieval'

export const buildKbDocumentDiscoveryTools = (
  input: Parameters<typeof localKbRetrievalCapability.buildTools>[0]
) =>
  localKbRetrievalCapability
    .buildTools(input)
    .filter((tool) => String(tool.name || '') === 'kb_list_documents')
