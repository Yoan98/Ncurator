import type { DocxOutlineBlock, DocxSearchMatch, SemanticDocIndexEntry } from './types'

export const isSemanticSearchableBlock = (
  block: DocxOutlineBlock
): block is Extract<DocxOutlineBlock, { type: 'paragraph' | 'table_cell' }> =>
  block.type === 'paragraph' || block.type === 'table_cell'

export const splitEmbeddingRows = (
  data: Float32Array,
  dims: [number, number]
): Float32Array[] => {
  const rowCount = Math.max(0, Number(dims[0] || 0))
  const colCount = Math.max(0, Number(dims[1] || 0))
  if (rowCount <= 0 || colCount <= 0) return []

  const rows: Float32Array[] = []
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * colCount
    const end = start + colCount
    rows.push(data.slice(start, end))
  }
  return rows
}

const dotProduct = (left: Float32Array, right: Float32Array): number => {
  const size = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < size; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

export const buildSemanticMatches = (input: {
  entries: SemanticDocIndexEntry[]
  queryEmbedding: Float32Array
  scopeBlockIds: string[]
  queryText: string
  topK: number
  minScore: number
}): DocxSearchMatch[] => {
  const scope = input.scopeBlockIds.length > 0 ? new Set(input.scopeBlockIds) : null
  const normalizedQuery = input.queryText.trim().toLowerCase()
  const scored = input.entries
    .filter((entry) => (scope ? scope.has(entry.blockId) : true))
    .map((entry) => {
      const text = entry.text.trim()
      const textLower = text.toLowerCase()
      const tokenBoost =
        normalizedQuery && textLower.includes(normalizedQuery)
          ? 0.35
          : normalizedQuery
            ? normalizedQuery
                .split(/\s+/)
                .filter(Boolean)
                .reduce((score, token) => (textLower.includes(token) ? score + 0.12 : score), 0)
            : 0
      return {
        blockId: entry.blockId,
        type: entry.blockType,
        blockIndex: entry.blockIndex,
        previousBlockId: entry.previousBlockId,
        nextBlockId: entry.nextBlockId,
        tableBlockId: entry.tableBlockId,
        text: entry.text,
        matchedText: input.queryText,
        score: dotProduct(entry.embedding, input.queryEmbedding) + tokenBoost
      }
    })
    .filter((item) => item.text.trim().length > 0)
    .sort((a, b) => b.score - a.score)

  return scored
    .filter((item) => item.score >= input.minScore)
    .slice(0, input.topK)
    .map((item) => ({
      blockId: item.blockId,
      type: item.type,
      blockIndex: item.blockIndex,
      previousBlockId: item.previousBlockId,
      nextBlockId: item.nextBlockId,
      tableBlockId: item.tableBlockId,
      text: item.text,
      matchedText: input.queryText,
      score: item.score
    }))
}
