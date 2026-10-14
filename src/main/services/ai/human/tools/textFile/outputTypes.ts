export type TextFileReadOutput = {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  nextStartLine?: number
}

export type TextFileSearchOutput = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{
    line: number
    matchText: string
    textContext: string
    truncated: boolean
  }>
}

export type TextFileEditOutput = Record<string, never>
