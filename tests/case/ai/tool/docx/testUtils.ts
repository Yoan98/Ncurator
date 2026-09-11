import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'

export type DocxSearchResult = {
  totalMatchCount: number
  matches: Array<{
    nodeId: string
    nodeIndex: number
    type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
    story: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox'
    matchText: string
    textContext: string
    tableNodeId?: string
    node?: DocxPublicReadRootNode
    beforeNodes?: DocxPublicReadRootNode[]
    afterNodes?: DocxPublicReadRootNode[]
  }>
}

export type DocxFailureResult = {
  error: string
  reason?: string
}
