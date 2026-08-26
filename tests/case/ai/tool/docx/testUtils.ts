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
    before?: Array<{ nodeId: string; nodeIndex: number; type: string; textPreview: string }>
    after?: Array<{ nodeId: string; nodeIndex: number; type: string; textPreview: string }>
  }>
}

export type DocxFailureResult = {
  error: string
  reason?: string
}
