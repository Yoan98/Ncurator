import { randomUUID } from 'node:crypto'
import {
  buildBlockExactSignature,
  buildBlockStructureSignature,
  buildParagraphFormattingSignature,
  blockSpecText,
  nodeToBlockSpec,
  normalizeDocxText,
  normalizeParagraphSpec
} from '../adapters/ooxml/blockSpec'
import { buildBlockIndex, loadDocxBundle } from '../adapters/ooxml/blockIndex'
import type {
  DocxBlockSpec,
  DocxChangedBlock,
  DocxOp,
  DocxParagraphSpec
} from '../types'
import { DOCX_CONFIRM_ANCHOR_PREFIX } from './constants'
import type { RunDraftChangeSeed } from './types'
import {
  buildDocxChangeLocator,
  buildDocxChangeSummary,
  buildDocxChangeTitle
} from './utils'

type ComparableTableCell = {
  blockId: string
  row: number
  col: number
  paragraphs: DocxParagraphSpec[]
  text: string
  normalizedText: string
  exactSignature: string
}

type ComparableDocxBodyBlock = {
  blockId: string
  bodyIndex: number
  kind: 'paragraph' | 'table'
  spec: DocxBlockSpec
  text: string
  normalizedText: string
  exactSignature: string
  structureSignature: string
  paragraphFormattingSignature?: string
  tableCells?: ComparableTableCell[]
}

type AlignmentStep =
  | {
      type: 'match'
      source: ComparableDocxBodyBlock
      latest: ComparableDocxBodyBlock
    }
  | {
      type: 'delete'
      source: ComparableDocxBodyBlock
    }
  | {
      type: 'insert'
      latest: ComparableDocxBodyBlock
    }

type PendingDocxChange = {
  op: DocxOp
  changedBlock: DocxChangedBlock
  targetBodyIndex: number
  sortBucket: number
  rowIndex?: number
  columnIndex?: number
}

type AnchorPair = {
  sourceIndex: number
  latestIndex: number
}

const GAP_PENALTY = -4

const normalizeParagraphs = (paragraphs: DocxParagraphSpec[]): DocxParagraphSpec[] =>
  paragraphs.map((paragraph) => normalizeParagraphSpec(paragraph))

const buildCellExactSignature = (paragraphs: DocxParagraphSpec[]): string =>
  JSON.stringify(normalizeParagraphs(paragraphs))

const buildTableCells = (tableBlockId: string, spec: Extract<DocxBlockSpec, { kind: 'table' }>): ComparableTableCell[] =>
  spec.rows.flatMap((row, rowIndex) =>
    row.map((cell, columnIndex) => {
      const paragraphs = normalizeParagraphs(cell.paragraphs)
      const text = paragraphs.map((paragraph) => blockSpecText(paragraph)).join('\n')
      return {
        blockId: `${tableBlockId}.r:${rowIndex + 1}.c:${columnIndex + 1}`,
        row: rowIndex + 1,
        col: columnIndex + 1,
        paragraphs,
        text,
        normalizedText: normalizeDocxText(text),
        exactSignature: buildCellExactSignature(paragraphs)
      }
    })
  )

const buildComparableDocxBlocks = async (buffer: Buffer): Promise<ComparableDocxBodyBlock[]> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildBlockIndex(bundle.documentDom)

  return index.outline
    .filter(
      (block): block is Extract<(typeof index.outline)[number], { type: 'paragraph' | 'table' }> =>
        block.type === 'paragraph' || block.type === 'table'
    )
    .map((outlineBlock) => {
      const node = index.nodesById.get(outlineBlock.blockId)
      if (!node || node.kind === 'table_cell') {
        throw new Error(`docx body block missing from index: ${outlineBlock.blockId}`)
      }

      const spec = nodeToBlockSpec(node)
      const text = blockSpecText(spec)
      const comparable: ComparableDocxBodyBlock = {
        blockId: outlineBlock.blockId,
        bodyIndex: node.bodyIndex,
        kind: spec.kind,
        spec,
        text,
        normalizedText: normalizeDocxText(text),
        exactSignature: buildBlockExactSignature(spec),
        structureSignature: buildBlockStructureSignature(spec)
      }

      if (spec.kind === 'paragraph') {
        comparable.paragraphFormattingSignature = buildParagraphFormattingSignature(spec)
      } else {
        comparable.tableCells = buildTableCells(outlineBlock.blockId, spec)
      }

      return comparable
    })
}

const computeTextSimilarity = (left: string, right: string): number => {
  if (left === right) return 1
  if (!left || !right) return 0

  const buildBigrams = (input: string): Map<string, number> => {
    const normalized = input.length === 1 ? `${input}_` : input
    const counts = new Map<string, number>()
    for (let index = 0; index < normalized.length - 1; index += 1) {
      const gram = normalized.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) || 0) + 1)
    }
    return counts
  }

  const leftBigrams = buildBigrams(left)
  const rightBigrams = buildBigrams(right)
  let overlap = 0

  leftBigrams.forEach((count, gram) => {
    const rightCount = rightBigrams.get(gram) || 0
    overlap += Math.min(count, rightCount)
  })

  const leftSize = [...leftBigrams.values()].reduce((sum, count) => sum + count, 0)
  const rightSize = [...rightBigrams.values()].reduce((sum, count) => sum + count, 0)
  if (leftSize === 0 || rightSize === 0) return 0
  return (2 * overlap) / (leftSize + rightSize)
}

const computeLengthRatio = (left: string, right: string): number => {
  if (!left && !right) return 1
  const leftLength = left.length
  const rightLength = right.length
  if (leftLength === 0 || rightLength === 0) return 0
  return Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength)
}

const computeParagraphMatchScore = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): number => {
  if (source.kind !== 'paragraph' || latest.kind !== 'paragraph') return 0
  if (source.exactSignature === latest.exactSignature) return 20
  if (source.structureSignature === latest.structureSignature && source.normalizedText === latest.normalizedText) {
    return 16
  }

  const similarity = computeTextSimilarity(source.normalizedText, latest.normalizedText)
  const lengthRatio = computeLengthRatio(source.normalizedText, latest.normalizedText)
  if (
    source.paragraphFormattingSignature === latest.paragraphFormattingSignature &&
    similarity >= 0.55 &&
    lengthRatio >= 0.35
  ) {
    return 12
  }
  if (
    source.paragraphFormattingSignature === latest.paragraphFormattingSignature &&
    similarity >= 0.25 &&
    lengthRatio >= 0.55
  ) {
    return 7
  }
  if (similarity >= 0.82) return 6
  return 0
}

const computeTableMatchScore = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): number => {
  if (source.kind !== 'table' || latest.kind !== 'table') return 0
  if (source.exactSignature === latest.exactSignature) return 20

  const sourceRows = source.spec.kind === 'table' ? source.spec.rows.length : 0
  const latestRows = latest.spec.kind === 'table' ? latest.spec.rows.length : 0
  const sourceCols = source.spec.kind === 'table' ? Math.max(0, ...source.spec.rows.map((row) => row.length)) : 0
  const latestCols = latest.spec.kind === 'table' ? Math.max(0, ...latest.spec.rows.map((row) => row.length)) : 0
  const sameShape = sourceRows === latestRows && sourceCols === latestCols
  const similarity = computeTextSimilarity(source.normalizedText, latest.normalizedText)

  if (sameShape && similarity >= 0.32) return 12
  if (sameShape) return 8
  if (Math.abs(sourceRows - latestRows) <= 1 && Math.abs(sourceCols - latestCols) <= 1) return 5
  if (similarity >= 0.72) return 5
  if (similarity >= 0.2) return 4
  return 0
}

const computeMatchScore = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): number => {
  if (source.kind !== latest.kind) return 0
  if (source.kind === 'paragraph') return computeParagraphMatchScore(source, latest)
  return computeTableMatchScore(source, latest)
}

const findExactAnchors = (
  sourceBlocks: ComparableDocxBodyBlock[],
  latestBlocks: ComparableDocxBodyBlock[]
): AnchorPair[] => {
  const sourceIndicesBySignature = new Map<string, number[]>()
  const latestIndicesBySignature = new Map<string, number[]>()

  sourceBlocks.forEach((block, index) => {
    const existing = sourceIndicesBySignature.get(block.exactSignature) || []
    existing.push(index)
    sourceIndicesBySignature.set(block.exactSignature, existing)
  })
  latestBlocks.forEach((block, index) => {
    const existing = latestIndicesBySignature.get(block.exactSignature) || []
    existing.push(index)
    latestIndicesBySignature.set(block.exactSignature, existing)
  })

  const candidates: AnchorPair[] = []
  sourceIndicesBySignature.forEach((sourceIndices, signature) => {
    const latestIndices = latestIndicesBySignature.get(signature)
    if (!latestIndices || sourceIndices.length !== 1 || latestIndices.length !== 1) return
    candidates.push({
      sourceIndex: sourceIndices[0],
      latestIndex: latestIndices[0]
    })
  })

  candidates.sort((left, right) => left.sourceIndex - right.sourceIndex)
  if (candidates.length <= 1) return candidates

  const lengths = new Array<number>(candidates.length).fill(1)
  const previous = new Array<number>(candidates.length).fill(-1)
  let bestIndex = 0

  for (let index = 0; index < candidates.length; index += 1) {
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (
        candidates[cursor].latestIndex < candidates[index].latestIndex &&
        lengths[cursor] + 1 > lengths[index]
      ) {
        lengths[index] = lengths[cursor] + 1
        previous[index] = cursor
      }
    }
    if (lengths[index] > lengths[bestIndex]) {
      bestIndex = index
    }
  }

  const selected: AnchorPair[] = []
  let cursor = bestIndex
  while (cursor >= 0) {
    selected.push(candidates[cursor])
    cursor = previous[cursor]
  }
  return selected.reverse()
}

const alignSegment = (
  sourceBlocks: ComparableDocxBodyBlock[],
  latestBlocks: ComparableDocxBodyBlock[]
): AlignmentStep[] => {
  if (sourceBlocks.length === 0) {
    return latestBlocks.map((block) => ({ type: 'insert', latest: block }))
  }
  if (latestBlocks.length === 0) {
    return sourceBlocks.map((block) => ({ type: 'delete', source: block }))
  }

  const width = latestBlocks.length + 1
  const directions = new Uint8Array((sourceBlocks.length + 1) * width)
  let previousRow = new Int32Array(width)

  for (let column = 1; column <= latestBlocks.length; column += 1) {
    previousRow[column] = previousRow[column - 1] + GAP_PENALTY
    directions[column] = 3
  }

  for (let row = 1; row <= sourceBlocks.length; row += 1) {
    const currentRow = new Int32Array(width)
    currentRow[0] = previousRow[0] + GAP_PENALTY
    directions[row * width] = 2

    for (let column = 1; column <= latestBlocks.length; column += 1) {
      let bestScore = previousRow[column] + GAP_PENALTY
      let bestDirection = 2

      const insertScore = currentRow[column - 1] + GAP_PENALTY
      if (insertScore > bestScore) {
        bestScore = insertScore
        bestDirection = 3
      }

      const matchScore = computeMatchScore(sourceBlocks[row - 1], latestBlocks[column - 1])
      if (matchScore > 0) {
        const diagonalScore = previousRow[column - 1] + matchScore
        if (diagonalScore >= bestScore) {
          bestScore = diagonalScore
          bestDirection = 1
        }
      }

      currentRow[column] = bestScore
      directions[row * width + column] = bestDirection
    }

    previousRow = currentRow
  }

  const steps: AlignmentStep[] = []
  let row = sourceBlocks.length
  let column = latestBlocks.length

  while (row > 0 || column > 0) {
    const direction = directions[row * width + column]
    if (row > 0 && column > 0 && direction === 1) {
      steps.push({
        type: 'match',
        source: sourceBlocks[row - 1],
        latest: latestBlocks[column - 1]
      })
      row -= 1
      column -= 1
      continue
    }

    if (row > 0 && (column === 0 || direction === 2)) {
      steps.push({
        type: 'delete',
        source: sourceBlocks[row - 1]
      })
      row -= 1
      continue
    }

    if (column > 0) {
      steps.push({
        type: 'insert',
        latest: latestBlocks[column - 1]
      })
      column -= 1
    }
  }

  return steps.reverse()
}

const buildAlignment = (
  sourceBlocks: ComparableDocxBodyBlock[],
  latestBlocks: ComparableDocxBodyBlock[]
): AlignmentStep[] => {
  const anchors = findExactAnchors(sourceBlocks, latestBlocks)
  if (anchors.length === 0) {
    return alignSegment(sourceBlocks, latestBlocks)
  }

  const steps: AlignmentStep[] = []
  let sourceCursor = 0
  let latestCursor = 0

  anchors.forEach((anchor) => {
    steps.push(
      ...alignSegment(
        sourceBlocks.slice(sourceCursor, anchor.sourceIndex),
        latestBlocks.slice(latestCursor, anchor.latestIndex)
      )
    )
    steps.push({
      type: 'match',
      source: sourceBlocks[anchor.sourceIndex],
      latest: latestBlocks[anchor.latestIndex]
    })
    sourceCursor = anchor.sourceIndex + 1
    latestCursor = anchor.latestIndex + 1
  })

  steps.push(...alignSegment(sourceBlocks.slice(sourceCursor), latestBlocks.slice(latestCursor)))
  return steps
}

const paragraphSpecsEqual = (left: DocxParagraphSpec, right: DocxParagraphSpec): boolean =>
  JSON.stringify(normalizeParagraphSpec(left)) === JSON.stringify(normalizeParagraphSpec(right))

const sameTableShape = (
  source: Extract<DocxBlockSpec, { kind: 'table' }>,
  latest: Extract<DocxBlockSpec, { kind: 'table' }>
): boolean => {
  if (source.rows.length !== latest.rows.length) return false
  return source.rows.every((row, index) => row.length === latest.rows[index]?.length)
}

const buildDeleteChange = (source: ComparableDocxBodyBlock): PendingDocxChange => {
  const op: DocxOp = {
    type: 'delete_block',
    blockId: source.blockId
  }
  return {
    op,
    changedBlock: {
      action: 'delete_block',
      blockId: source.blockId,
      beforeText: source.text,
      afterText: ''
    },
    targetBodyIndex: source.bodyIndex,
    sortBucket: 10
  }
}

const buildInsertChange = (
  anchorBlock: ComparableDocxBodyBlock,
  insertedBlocks: ComparableDocxBodyBlock[],
  position: 'before' | 'after'
): PendingDocxChange => {
  const content = insertedBlocks.map((block) => block.spec)
  const op: DocxOp =
    position === 'before'
      ? {
          type: 'insert_before',
          anchorBlockId: anchorBlock.blockId,
          content
        }
      : {
          type: 'insert_after',
          anchorBlockId: anchorBlock.blockId,
          content
        }
  const insertedText = insertedBlocks.map((block) => block.text).filter(Boolean).join('\n')
  return {
    op,
    changedBlock: {
      action: op.type,
      blockId: anchorBlock.blockId,
      beforeText: '',
      afterText: insertedText
    },
    targetBodyIndex: anchorBlock.bodyIndex,
    sortBucket: position === 'before' ? 30 : 31
  }
}

const buildParagraphChange = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): PendingDocxChange | null => {
  if (source.spec.kind !== 'paragraph' || latest.spec.kind !== 'paragraph') return null
  if (source.exactSignature === latest.exactSignature) return null

  const isTextOnlyChange =
    source.paragraphFormattingSignature === latest.paragraphFormattingSignature &&
    source.text !== latest.text &&
    source.text.length > 0

  if (isTextOnlyChange) {
    const op: DocxOp = {
      type: 'replace_text',
      query: source.text,
      replace: latest.text,
      blockIds: [source.blockId]
    }
    return {
      op,
      changedBlock: {
        action: 'replace_text',
        blockId: source.blockId,
        beforeText: source.text,
        afterText: latest.text
      },
      targetBodyIndex: source.bodyIndex,
      sortBucket: 12
    }
  }

  const op: DocxOp = {
    type: 'replace_block',
    blockId: source.blockId,
    content: latest.spec
  }
  return {
    op,
    changedBlock: {
      action: 'replace_block',
      blockId: source.blockId,
      beforeText: source.text,
      afterText: latest.text
    },
    targetBodyIndex: source.bodyIndex,
    sortBucket: 11
  }
}

const buildTableCellChanges = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): PendingDocxChange[] => {
  if (
    source.kind !== 'table' ||
    latest.kind !== 'table' ||
    source.spec.kind !== 'table' ||
    latest.spec.kind !== 'table' ||
    !source.tableCells ||
    !latest.tableCells
  ) {
    return []
  }

  if (!sameTableShape(source.spec, latest.spec)) {
    const op: DocxOp = {
      type: 'replace_block',
      blockId: source.blockId,
      content: latest.spec
    }
    return [
      {
        op,
        changedBlock: {
          action: 'replace_block',
          blockId: source.blockId,
          beforeText: source.text,
          afterText: latest.text
        },
        targetBodyIndex: source.bodyIndex,
        sortBucket: 11
      }
    ]
  }

  const changes: PendingDocxChange[] = []
  source.tableCells.forEach((sourceCell, index) => {
    const latestCell = latest.tableCells?.[index]
    if (!latestCell) return
    if (sourceCell.exactSignature === latestCell.exactSignature) return

    const paragraphsChanged =
      sourceCell.paragraphs.length !== latestCell.paragraphs.length ||
      sourceCell.paragraphs.some(
        (paragraph, paragraphIndex) =>
          !paragraphSpecsEqual(paragraph, latestCell.paragraphs[paragraphIndex])
      )
    if (!paragraphsChanged) return

    const op: DocxOp = {
      type: 'update_table_cell',
      blockId: sourceCell.blockId,
      content: latestCell.paragraphs
    }
    changes.push({
      op,
      changedBlock: {
        action: 'update_table_cell',
        blockId: sourceCell.blockId,
        beforeText: sourceCell.text,
        afterText: latestCell.text
      },
      targetBodyIndex: source.bodyIndex,
      sortBucket: 20,
      rowIndex: sourceCell.row,
      columnIndex: sourceCell.col
    })
  })

  return changes
}

const buildMatchedChanges = (
  source: ComparableDocxBodyBlock,
  latest: ComparableDocxBodyBlock
): PendingDocxChange[] => {
  if (source.exactSignature === latest.exactSignature) return []
  if (source.kind === 'paragraph' && latest.kind === 'paragraph') {
    const change = buildParagraphChange(source, latest)
    return change ? [change] : []
  }
  if (source.kind === 'table' && latest.kind === 'table') {
    return buildTableCellChanges(source, latest)
  }

  const op: DocxOp = {
    type: 'replace_block',
    blockId: source.blockId,
    content: latest.spec
  }
  return [
    {
      op,
      changedBlock: {
        action: 'replace_block',
        blockId: source.blockId,
        beforeText: source.text,
        afterText: latest.text
      },
      targetBodyIndex: source.bodyIndex,
      sortBucket: 11
    }
  ]
}

const toRunDraftChangeSeed = (
  change: PendingDocxChange,
  orderIndex: number,
  latestDraftSnapshotId: string
): RunDraftChangeSeed => ({
  id: randomUUID(),
  orderIndex,
  changeKind: change.op.type === 'update_table_cell' ? 'table_cell' : 'block',
  title: buildDocxChangeTitle(change.op, change.changedBlock),
  summary: buildDocxChangeSummary(change.op, change.changedBlock),
  beforeText: change.changedBlock.beforeText,
  afterText: change.changedBlock.afterText,
  locator: buildDocxChangeLocator(change.changedBlock),
  metadata: {
    engine: 'docx_cumulative_diff_v1',
    latest_draft_snapshot_id: latestDraftSnapshotId,
    docx_op_json: JSON.stringify(change.op)
  },
  anchorName: `${DOCX_CONFIRM_ANCHOR_PREFIX}${randomUUID().replace(/-/g, '')}`,
  docxOp: change.op
})

const sortPendingChanges = (changes: PendingDocxChange[]): PendingDocxChange[] =>
  changes.slice().sort((left, right) => {
    if (left.targetBodyIndex !== right.targetBodyIndex) {
      return right.targetBodyIndex - left.targetBodyIndex
    }
    if (left.sortBucket !== right.sortBucket) {
      return left.sortBucket - right.sortBucket
    }
    if ((left.rowIndex || 0) !== (right.rowIndex || 0)) {
      return (left.rowIndex || 0) - (right.rowIndex || 0)
    }
    return (left.columnIndex || 0) - (right.columnIndex || 0)
  })

export const computeCumulativeDocxChangeSeeds = async (input: {
  sourceBuffer: Buffer
  latestDraftBuffer: Buffer
  latestDraftSnapshotId: string
}): Promise<RunDraftChangeSeed[]> => {
  const sourceBlocks = await buildComparableDocxBlocks(input.sourceBuffer)
  const latestBlocks = await buildComparableDocxBlocks(input.latestDraftBuffer)
  const alignment = buildAlignment(sourceBlocks, latestBlocks)
  const pendingChanges: PendingDocxChange[] = []
  const pendingInsertions: ComparableDocxBodyBlock[] = []
  let trailingSourceBlock: ComparableDocxBodyBlock | null = null

  const flushInsertions = (nextSourceBlock: ComparableDocxBodyBlock | null): void => {
    if (pendingInsertions.length === 0) return
    if (nextSourceBlock) {
      pendingChanges.push(buildInsertChange(nextSourceBlock, pendingInsertions.splice(0), 'before'))
      return
    }
    if (trailingSourceBlock) {
      pendingChanges.push(buildInsertChange(trailingSourceBlock, pendingInsertions.splice(0), 'after'))
      return
    }
    throw new Error('docx cumulative diff does not support inserting into an empty source document')
  }

  alignment.forEach((step) => {
    if (step.type === 'insert') {
      pendingInsertions.push(step.latest)
      return
    }

    flushInsertions(step.source)
    if (step.type === 'delete') {
      pendingChanges.push(buildDeleteChange(step.source))
      trailingSourceBlock = step.source
      return
    }

    pendingChanges.push(...buildMatchedChanges(step.source, step.latest))
    trailingSourceBlock = step.source
  })

  flushInsertions(null)

  return sortPendingChanges(pendingChanges).map((change, index) =>
    toRunDraftChangeSeed(change, index + 1, input.latestDraftSnapshotId)
  )
}
