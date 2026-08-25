export type DocxSearchResult = {
  sourcePath: string
  mode: 'literal' | 'regex' | 'semantic'
  effectiveQuery: string
  appliedAliases: Array<{ from: string; to: string }>
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{
    nodeId: string
    nodeIndex: number
    type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
    matchedText: string
    text: string
    offsets?: Array<{ start: number; end: number }>
    score?: number
  }>
}

export type DocxFailureResult = {
  error: string
  reason?: string
}
