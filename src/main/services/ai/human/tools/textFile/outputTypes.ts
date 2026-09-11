export type TextFileReadOutput = {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  nextStartLine?: number
}

export const TEXT_FILE_SEARCH_OUTPUT = {
  totalMatchCount: 0 as number,
  returnedMatchCount: 0 as number,
  matches: [] as Array<{
    line: number
    matchText: string
    textContext: string
    truncated: boolean
  }>
}

export type TextFileSearchOutput = typeof TEXT_FILE_SEARCH_OUTPUT

export type TextFileEditOutput = Record<string, never>
