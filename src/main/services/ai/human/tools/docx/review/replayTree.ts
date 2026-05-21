import type {
  DocxBlockSpec,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxDetailedParagraphBlock,
  DocxDetailedTableBlock,
  DocxOp,
  DocxOutlineBlock,
  DocxReplayNode,
  DocxReplaySession,
  DocxReplaySnapshot,
  DocxReplaySnapshotBlock,
  DocxReviewState
} from '../types'

const normalizeParagraphSpec = (block: DocxDetailedParagraphBlock): Extract<DocxBlockSpec, { kind: 'paragraph' }> => ({
  kind: 'paragraph',
  style: block.style || 'Normal',
  runs: block.runs.length > 0 ? block.runs.map((run) => ({ ...run })) : [{ text: block.text || '' }]
})

const normalizeTableSpec = (block: DocxDetailedTableBlock): Extract<DocxBlockSpec, { kind: 'table' }> => ({
  kind: 'table',
  rows: Array.from({ length: block.rows }, (_, rowIndex) =>
    Array.from({ length: block.cols }, (_, colIndex) => {
      const cell = block.cells.find((item) => item.row === rowIndex + 1 && item.col === colIndex + 1)
      return {
        paragraphs:
          cell && cell.paragraphs.length > 0
            ? cell.paragraphs.map((paragraph) => normalizeParagraphSpec(paragraph))
            : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
      }
    })
  )
})

export const detailedBlockToSpec = (block: DocxDetailedBlock): DocxBlockSpec => {
  if (block.type === 'paragraph') return normalizeParagraphSpec(block)
  if (block.type === 'table') return normalizeTableSpec(block)
  return {
    kind: 'paragraph',
    style: block.paragraphs[0]?.style || 'Normal',
    runs: [{ text: block.text || '' }]
  }
}

export const createReplaySnapshot = (input: {
  outlineBlocks: DocxOutlineBlock[]
  detailedBlocksById: Map<string, DocxDetailedBlock>
}): DocxReplaySnapshot => {
  const blocks: DocxReplaySnapshotBlock[] = []
  const blockById = new Map<string, DocxReplaySnapshotBlock>()
  const tableBlockIdByCellBlockId = new Map<string, string>()

  input.outlineBlocks.forEach((block) => {
    if (block.type === 'table_cell') {
      tableBlockIdByCellBlockId.set(block.blockId, block.tableBlockId)
      return
    }

    const detail = input.detailedBlocksById.get(block.blockId)
    if (!detail || detail.type === 'table_cell') return

    const snapshotBlock: DocxReplaySnapshotBlock = {
      blockId: block.blockId,
      blockIndex: block.blockIndex,
      kind: detail.type,
      spec: detailedBlockToSpec(detail),
      tableCellBlockIds:
        detail.type === 'table'
          ? detail.cells.map((cell) => cell.blockId)
          : [],
      tableCells:
        detail.type === 'table'
          ? detail.cells.map((cell) => ({
              blockId: cell.blockId,
              row: cell.row,
              col: cell.col,
              text: cell.paragraphs.map((paragraph) => paragraph.text).join('\n')
            }))
          : undefined
    }

    blocks.push(snapshotBlock)
    blockById.set(snapshotBlock.blockId, snapshotBlock)
    snapshotBlock.tableCellBlockIds.forEach((cellBlockId) => {
      tableBlockIdByCellBlockId.set(cellBlockId, snapshotBlock.blockId)
    })
  })

  return {
    blocks,
    blockById,
    tableBlockIdByCellBlockId
  }
}

export const createEmptyReplaySnapshot = (): DocxReplaySnapshot => ({
  blocks: [],
  blockById: new Map(),
  tableBlockIdByCellBlockId: new Map()
})

const buildNode = (input: {
  blockId: string
  blockIndex: number
  kind: 'paragraph' | 'table'
  sourceOrigin: 'source' | 'generated'
  reviewState: DocxReviewState
  parentNodeId?: string
  sourceBlockId?: string
  currentBlockId?: string
  spec: DocxBlockSpec
  createdRevisionRef: string
  changedRevisionRef?: string
  reviewQuery?: string
}): DocxReplayNode => ({
  nodeId: `${input.reviewState}:${input.blockId}:${input.createdRevisionRef}:${input.changedRevisionRef || 'active'}`,
  blockId: input.blockId,
  blockIndex: input.blockIndex,
  kind: input.kind,
  sourceOrigin: input.sourceOrigin,
  reviewState: input.reviewState,
  parentNodeId: input.parentNodeId,
  sourceBlockId: input.sourceBlockId,
  currentBlockId: input.currentBlockId,
  predecessorNodeId: undefined,
  successorNodeId: undefined,
  replacedFromNodeId: undefined,
  anchorFromNodeId: undefined,
  anchorSide: undefined,
  spec: input.spec,
  createdRevisionRef: input.createdRevisionRef,
  changedRevisionRef: input.changedRevisionRef,
  reviewQuery: input.reviewQuery
})

const reindexBodyNodes = (session: DocxReplaySession): void => {
  session.bodyNodeIds.forEach((nodeId, index) => {
    const node = session.nodeById.get(nodeId)
    if (node) node.blockIndex = index
  })
}

const isVisibleReviewState = (reviewState: DocxReviewState): boolean =>
  reviewState !== 'deleted' && reviewState !== 'replaced-old'

const buildParagraphSignature = (spec: Extract<DocxBlockSpec, { kind: 'paragraph' }>): string =>
  `p:${spec.style || 'Normal'}:${spec.runs
    .map(
      (run) =>
        `${run.text}|b:${run.bold ? '1' : '0'}|i:${run.italic ? '1' : '0'}|u:${run.underline ? '1' : '0'}|c:${run.color || ''}`
    )
    .join('\u241D')}`

const buildSpecKey = (spec: DocxBlockSpec): string => {
  if (spec.kind === 'paragraph') {
    return buildParagraphSignature(spec)
  }
  return `t:${spec.rows
    .map((row) => row.map((cell) => cell.paragraphs.map((paragraph) => buildParagraphSignature(paragraph)).join('\u241E')).join('\u241F'))
    .join('\u2424')}`
}

const findSnapshotMatchIndex = (input: {
  cursor: number
  nextSnapshot: DocxReplaySnapshot
  node: DocxReplayNode
  usedBlockIds: Set<string>
  reservedBlockIds?: ReadonlySet<string>
}): number => {
  if (input.node.sourceOrigin === 'generated') {
    for (let index = input.cursor; index < input.nextSnapshot.blocks.length; index += 1) {
      const block = input.nextSnapshot.blocks[index]
      if (
        input.usedBlockIds.has(block.blockId) ||
        input.reservedBlockIds?.has(block.blockId) ||
        block.kind !== input.node.kind
      ) {
        continue
      }
      if (
        block.blockId === input.node.currentBlockId ||
        block.blockId === input.node.blockId ||
        (input.node.sourceBlockId && block.blockId === input.node.sourceBlockId)
      ) {
        return index
      }
    }
  }

  const nodeKey = buildSpecKey(input.node.spec)
  for (let index = input.cursor; index < input.nextSnapshot.blocks.length; index += 1) {
    const block = input.nextSnapshot.blocks[index]
    if (
      input.usedBlockIds.has(block.blockId) ||
      input.reservedBlockIds?.has(block.blockId) ||
      block.kind !== input.node.kind
    ) {
      continue
    }
    if (buildSpecKey(block.spec) === nodeKey) {
      return index
    }
  }

  return -1
}

const rebindVisibleNodesToSnapshot = (input: {
  session: DocxReplaySession
  nextSnapshot: DocxReplaySnapshot
  skipNodeIds?: ReadonlySet<string>
  reservedBlockIds?: ReadonlySet<string>
}): void => {
  const { nextSnapshot, session, skipNodeIds, reservedBlockIds } = input
  const visibleNodes = session.bodyNodeIds
    .map((nodeId) => session.nodeById.get(nodeId))
    .filter((node): node is DocxReplayNode => Boolean(node && isVisibleReviewState(node.reviewState)))
  const usedBlockIds = new Set<string>()
  let cursor = 0

  visibleNodes.forEach((node) => {
    const matchIndex = findSnapshotMatchIndex({
      cursor,
      nextSnapshot,
      node,
      usedBlockIds,
      reservedBlockIds
    })
    if (matchIndex < 0) return

    const matchedBlock = nextSnapshot.blocks[matchIndex]
    usedBlockIds.add(matchedBlock.blockId)
    cursor = matchIndex + 1
    if (skipNodeIds?.has(node.nodeId)) return
    node.currentBlockId = matchedBlock.blockId
    node.blockIndex = matchedBlock.blockIndex
    node.spec = matchedBlock.spec
  })
}

const resolveInsertIndex = (
  session: DocxReplaySession,
  anchorNodeId: string | undefined,
  position: 'before' | 'after'
): number => {
  if (!anchorNodeId) return position === 'before' ? 0 : session.bodyNodeIds.length
  const anchorIndex = session.bodyNodeIds.findIndex((nodeId) => nodeId === anchorNodeId)
  if (anchorIndex < 0) return session.bodyNodeIds.length
  if (position === 'before') return anchorIndex

  let insertIndex = anchorIndex + 1
  while (insertIndex < session.bodyNodeIds.length) {
    const candidate = session.nodeById.get(session.bodyNodeIds[insertIndex])
    if (!candidate || candidate.parentNodeId !== anchorNodeId || !isVisibleReviewState(candidate.reviewState)) {
      break
    }
    insertIndex += 1
  }
  return insertIndex
}

const insertNodeIds = (
  session: DocxReplaySession,
  anchorNodeId: string | undefined,
  nodeIds: string[],
  position: 'before' | 'after'
): void => {
  const insertIndex = resolveInsertIndex(session, anchorNodeId, position)
  session.bodyNodeIds.splice(insertIndex, 0, ...nodeIds)
  reindexBodyNodes(session)
}

const findVisibleNodeIdByBlockId = (session: DocxReplaySession, blockId: string): string | undefined =>
  session.bodyNodeIds.find((nodeId) => {
    const node = session.nodeById.get(nodeId)
    return Boolean(
      node &&
        (node.currentBlockId === blockId || node.blockId === blockId || node.sourceBlockId === blockId) &&
        node.reviewState !== 'deleted' &&
        node.reviewState !== 'replaced-old'
    )
  })

const resolveBodyBlocksFromCreated = (
  snapshot: DocxReplaySnapshot,
  createdBlocks: DocxCreatedBlock[]
): DocxReplaySnapshotBlock[] => {
  const createdBodyIds = new Set(
    createdBlocks
      .filter((block) => block.type !== 'table_cell')
      .map((block) => block.blockId)
  )
  return snapshot.blocks.filter((block) => createdBodyIds.has(block.blockId))
}

const cloneNodeAsOldRevision = (
  node: DocxReplayNode,
  revisionRef: string,
  reviewState: 'deleted' | 'replaced-old'
): DocxReplayNode => ({
  ...node,
  nodeId: `${node.nodeId}:${reviewState}:${revisionRef}`,
  currentBlockId: undefined,
  reviewState,
  successorNodeId: undefined,
  changedRevisionRef: revisionRef,
  reviewQuery: undefined
})

const buildCurrentNodeFromSnapshot = (
  snapshotBlock: DocxReplaySnapshotBlock,
  revisionRef: string,
  reviewState: 'inserted' | 'replaced-new',
  sourceOrigin: 'source' | 'generated',
  sourceBlockId?: string,
  parentNodeId?: string
): DocxReplayNode =>
  buildNode({
    blockId: snapshotBlock.blockId,
    blockIndex: snapshotBlock.blockIndex,
    kind: snapshotBlock.kind,
    sourceOrigin,
    reviewState,
    parentNodeId,
    sourceBlockId,
    currentBlockId: snapshotBlock.blockId,
    spec: snapshotBlock.spec,
    createdRevisionRef: revisionRef
  })

const replaceNodeWithReviewPair = (input: {
  session: DocxReplaySession
  targetNodeId: string
  oldNode: DocxReplayNode
  newNode: DocxReplayNode
}): void => {
  const index = input.session.bodyNodeIds.findIndex((nodeId) => nodeId === input.targetNodeId)
  if (index < 0) return
  input.session.nodeById.set(input.oldNode.nodeId, input.oldNode)
  input.session.nodeById.set(input.newNode.nodeId, input.newNode)
  input.session.nodeById.set(input.targetNodeId, input.oldNode)
  input.session.bodyNodeIds.splice(index, 1, input.oldNode.nodeId, input.newNode.nodeId)
  reindexBodyNodes(input.session)
}

const resolveSnapshotBlockForMutation = (input: {
  session: DocxReplaySession
  nextSnapshot: DocxReplaySnapshot
  createdBlocks: DocxCreatedBlock[]
  targetBlockId: string
}): DocxReplaySnapshotBlock | undefined => {
  const createdBodyBlocks = resolveBodyBlocksFromCreated(input.nextSnapshot, input.createdBlocks)
  if (createdBodyBlocks.length > 0) return createdBodyBlocks[0]
  const direct = input.nextSnapshot.blockById.get(input.targetBlockId)
  if (direct) return direct
  const tableBlockId = input.nextSnapshot.tableBlockIdByCellBlockId.get(input.targetBlockId)
  return tableBlockId ? input.nextSnapshot.blockById.get(tableBlockId) : undefined
}

export const createReplaySessionFromSnapshot = (input: {
  sourcePath: string
  targetMode?: DocxReplaySession['targetMode']
  sourceDocId: string
  meta: DocxReplaySession['meta']
  stats: DocxReplaySession['stats']
  snapshot: DocxReplaySnapshot
}): DocxReplaySession => {
  const nodeById = new Map<string, DocxReplayNode>()
  const bodyNodeIds: string[] = []

  input.snapshot.blocks.forEach((block) => {
    const node = buildNode({
      blockId: block.blockId,
      blockIndex: block.blockIndex,
      kind: block.kind,
      sourceOrigin: 'source',
      reviewState: 'normal',
      sourceBlockId: block.blockId,
      currentBlockId: block.blockId,
      spec: block.spec,
      createdRevisionRef: 'v1'
    })
    nodeById.set(node.nodeId, node)
    bodyNodeIds.push(node.nodeId)
  })

  return {
    sourcePath: input.sourcePath,
    targetMode: input.targetMode || 'update',
    sourceDocId: input.sourceDocId,
    activeDocId: input.sourceDocId,
    activeRevisionRef: 'v1',
    nextRevisionNumber: 2,
    meta: input.meta,
    stats: input.stats,
    sourceSnapshot: input.snapshot,
    activeSnapshot: input.snapshot,
    docIdByRevisionRef: new Map([['v1', input.sourceDocId]]),
    revisionRefByDocId: new Map([[input.sourceDocId, 'v1']]),
    revisionByDocId: new Map(),
    nodeById,
    bodyNodeIds,
    viewArtifacts: {}
  }
}

export const applyRevisionToReplaySession = (input: {
  session: DocxReplaySession
  revisionRef: string
  op: DocxOp
  createdBlocks: DocxCreatedBlock[]
  nextSnapshot: DocxReplaySnapshot
}): void => {
  const { session, revisionRef, op, createdBlocks, nextSnapshot } = input
  if (op.type === 'create_document') {
    const createdBodyBlocks = resolveBodyBlocksFromCreated(nextSnapshot, createdBlocks)
    const insertedNodeIds = createdBodyBlocks.map((block) => {
      const node = buildCurrentNodeFromSnapshot(
        block,
        revisionRef,
        'inserted',
        'generated'
      )
      session.nodeById.set(node.nodeId, node)
      return node.nodeId
    })
    insertNodeIds(session, undefined, insertedNodeIds, 'after')
    session.activeSnapshot = nextSnapshot
    return
  }

  const targetBlockId =
    op.type === 'update_table_cell' || (op.type === 'replace_text' && Array.isArray(op.blockIds) && op.blockIds[0])
      ? op.type === 'update_table_cell'
        ? op.blockId
        : String(op.blockIds?.[0] || '')
      : 'blockId' in op
        ? String(op.blockId || '')
        : ''
  const targetNodeId = targetBlockId ? findVisibleNodeIdByBlockId(session, targetBlockId) : undefined
  const targetNodeIdsToSkip =
    targetNodeId &&
    (op.type === 'delete_block' ||
      op.type === 'replace_block' ||
      op.type === 'replace_text' ||
      op.type === 'style_text' ||
      op.type === 'update_table_cell')
      ? new Set([targetNodeId])
      : undefined
  const reservedBlockIds =
    op.type === 'insert_before' || op.type === 'insert_after'
      ? new Set(resolveBodyBlocksFromCreated(nextSnapshot, createdBlocks).map((block) => block.blockId))
      : undefined

  rebindVisibleNodesToSnapshot({
    session,
    nextSnapshot,
    skipNodeIds: targetNodeIdsToSkip,
    reservedBlockIds
  })

  if (op.type === 'insert_before' || op.type === 'insert_after') {
    const anchorNodeId = findVisibleNodeIdByBlockId(session, op.anchorBlockId)
    const createdBodyBlocks = resolveBodyBlocksFromCreated(nextSnapshot, createdBlocks)
    const insertedNodeIds = createdBodyBlocks.map((block) => {
      const node = buildCurrentNodeFromSnapshot(
        block,
        revisionRef,
        'inserted',
        'generated',
        undefined,
        anchorNodeId
      )
      node.anchorFromNodeId = anchorNodeId
      node.anchorSide = op.type === 'insert_before' ? 'before' : 'after'
      session.nodeById.set(node.nodeId, node)
      return node.nodeId
    })
    insertNodeIds(session, anchorNodeId, insertedNodeIds, op.type === 'insert_before' ? 'before' : 'after')
    session.activeSnapshot = nextSnapshot
    return
  }

  if (op.type === 'delete_block') {
    const targetNodeId = findVisibleNodeIdByBlockId(session, op.blockId)
    if (targetNodeId) {
      const targetNode = session.nodeById.get(targetNodeId)
      if (targetNode) {
        targetNode.reviewState = 'deleted'
        targetNode.currentBlockId = undefined
        targetNode.changedRevisionRef = revisionRef
      }
    }
    session.activeSnapshot = nextSnapshot
    return
  }

  const targetNode = targetNodeId ? session.nodeById.get(targetNodeId) : undefined

  if (!targetNodeId || !targetNode) {
    session.activeSnapshot = nextSnapshot
    return
  }

  if (op.type === 'style_text') {
    const snapshotBlock = resolveSnapshotBlockForMutation({
      session,
      nextSnapshot,
      createdBlocks,
      targetBlockId
    })
    if (!snapshotBlock) {
      targetNode.reviewState = 'formatted'
      targetNode.changedRevisionRef = revisionRef
      targetNode.reviewQuery = op.query
      session.activeSnapshot = nextSnapshot
      return
    }

    targetNode.reviewState = 'formatted'
    targetNode.currentBlockId = snapshotBlock.blockId
    targetNode.blockIndex = snapshotBlock.blockIndex
    targetNode.spec = snapshotBlock.spec
    targetNode.changedRevisionRef = revisionRef
    targetNode.reviewQuery = op.query
    session.activeSnapshot = nextSnapshot
    return
  }

  const oldState =
    op.type === 'replace_block' ||
    op.type === 'replace_text' ||
    op.type === 'update_table_cell'
      ? 'replaced-old'
      : 'deleted'

  const oldNode = cloneNodeAsOldRevision(targetNode, revisionRef, oldState)
  const snapshotBlock = resolveSnapshotBlockForMutation({
    session,
    nextSnapshot,
    createdBlocks,
    targetBlockId
  })

  if (!snapshotBlock) {
    targetNode.reviewState = oldState
    targetNode.currentBlockId = undefined
    targetNode.changedRevisionRef = revisionRef
    session.activeSnapshot = nextSnapshot
    return
  }

  const newNode = buildCurrentNodeFromSnapshot(
    snapshotBlock,
    revisionRef,
    'replaced-new',
    targetNode.sourceOrigin,
    targetNode.sourceBlockId
  )
  oldNode.successorNodeId = newNode.nodeId
  newNode.predecessorNodeId = oldNode.nodeId
  newNode.replacedFromNodeId = targetNode.nodeId
  replaceNodeWithReviewPair({
    session,
    targetNodeId,
    oldNode,
    newNode
  })
  session.activeSnapshot = nextSnapshot
}

export const projectReplayNodes = (
  session: DocxReplaySession,
  kind: 'working' | 'review' | 'committed'
): DocxReplayNode[] =>
  session.bodyNodeIds
    .map((nodeId) => session.nodeById.get(nodeId))
    .filter((node): node is DocxReplayNode => Boolean(node))
    .filter((node) => {
      if (kind === 'review') return true
      return (
        node.reviewState === 'normal' ||
        node.reviewState === 'formatted' ||
        node.reviewState === 'inserted' ||
        node.reviewState === 'replaced-new'
      )
    })
