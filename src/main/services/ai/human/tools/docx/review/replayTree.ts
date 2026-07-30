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

const readParagraphRuns = (block: DocxDetailedParagraphBlock) => {
  const runs: Extract<DocxBlockSpec, { kind: 'paragraph' }>['runs'] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const value = node as { type?: string; style?: Record<string, unknown>; children?: unknown[] }
    if (value.type === 'run') {
      const text = (value.children || [])
        .map((child) => {
          const item = child as { type?: string; text?: string }
          return item.type === 'text'
            ? item.text || ''
            : item.type === 'tab'
              ? '\t'
              : item.type === 'break'
                ? '\n'
                : ''
        })
        .join('')
      if (text)
        runs.push({
          text,
          bold: value.style?.bold as boolean | undefined,
          italic: value.style?.italic as boolean | undefined,
          underline: value.style?.underline as boolean | undefined,
          color: value.style?.color as string | undefined
        })
      return
    }
    ;(value.children || []).forEach(visit)
  }
  block.children.forEach(visit)
  return runs
}

const normalizeParagraphSpec = (
  block: DocxDetailedParagraphBlock
): Extract<DocxBlockSpec, { kind: 'paragraph' }> => ({
  kind: 'paragraph',
  style: block.style?.styleName || 'Normal',
  runs:
    readParagraphRuns(block).length > 0 ? readParagraphRuns(block) : [{ text: block.text || '' }]
})

const normalizeTableSpec = (
  block: DocxDetailedTableBlock
): Extract<DocxBlockSpec, { kind: 'table' }> => ({
  kind: 'table',
  rows: Array.from({ length: block.rows }, (_, rowIndex) =>
    Array.from({ length: block.cols }, (_, colIndex) => {
      const cell = block.children[rowIndex]?.children[colIndex]
      return {
        paragraphs:
          cell && cell.children.length > 0
            ? cell.children
                .filter(
                  (child): child is Extract<typeof child, { type: 'paragraph' }> =>
                    child.type === 'paragraph'
                )
                .map((paragraph) =>
                  normalizeParagraphSpec({
                    ...paragraph,
                    blockId: '',
                    blockIndex: block.blockIndex,
                    layoutMode: block.layoutMode
                  })
                )
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
    style: 'Normal',
    runs: [{ text: block.text || '' }]
  }
}

const snapshotStructure = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(snapshotStructure)
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(node)
      .filter(
        ([key]) =>
          ![
            'blockId',
            'nodeId',
            'visualId',
            'blockIndex',
            'previousBlockId',
            'nextBlockId'
          ].includes(key)
      )
      .map(([key, child]) => [key, snapshotStructure(child)])
  )
}

const collectSnapshotVisuals = (
  value: unknown
): Array<{ visualId: string; kind: import('../types').DocxVisualKind }> => {
  const out: Array<{ visualId: string; kind: import('../types').DocxVisualKind }> = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const value = node as {
      type?: string
      visualId?: string
      kind?: import('../types').DocxVisualKind
      children?: unknown[]
    }
    if (value.type === 'visual' && value.visualId && value.kind)
      out.push({ visualId: value.visualId, kind: value.kind })
    ;(value.children || []).forEach(visit)
  }
  visit(value)
  return out
}

export const createReplaySnapshot = (input: {
  outlineBlocks: DocxOutlineBlock[]
  detailedBlocksById: Map<string, DocxDetailedBlock>
  rawXmlByBlockId: Map<string, string>
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
      rawXml: input.rawXmlByBlockId.get(block.blockId) || '',
      spec: detailedBlockToSpec(detail),
      structureFingerprint: JSON.stringify(snapshotStructure(detail)),
      visuals: collectSnapshotVisuals(detail),
      tableCellBlockIds:
        detail.type === 'table'
          ? input.outlineBlocks
              .filter(
                (candidate) =>
                  candidate.type === 'table_cell' && candidate.tableBlockId === detail.blockId
              )
              .map((cell) => cell.blockId)
          : [],
      tableCells:
        detail.type === 'table'
          ? input.outlineBlocks
              .filter(
                (candidate): candidate is Extract<DocxOutlineBlock, { type: 'table_cell' }> =>
                  candidate.type === 'table_cell' && candidate.tableBlockId === detail.blockId
              )
              .map((cell) => ({
                blockId: cell.blockId,
                row: cell.row,
                col: cell.col,
                text: cell.text,
                rawXml: input.rawXmlByBlockId.get(cell.blockId) || '',
                structureFingerprint: JSON.stringify(
                  snapshotStructure(input.detailedBlocksById.get(cell.blockId))
                ),
                visuals: collectSnapshotVisuals(input.detailedBlocksById.get(cell.blockId))
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
  structureFingerprint: string
  visualIds: string[]
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
  structureFingerprint: input.structureFingerprint,
  visualIds: input.visualIds,
  createdRevisionRef: input.createdRevisionRef,
  changedRevisionRef: input.changedRevisionRef,
  reviewQuery: input.reviewQuery,
  tableCellChanges: undefined
})

const reindexBodyNodes = (session: DocxReplaySession): void => {
  session.bodyNodeIds.forEach((nodeId, index) => {
    const node = session.nodeById.get(nodeId)
    if (node) node.blockIndex = index
  })
}

const isVisibleReviewState = (reviewState: DocxReviewState): boolean =>
  reviewState !== 'deleted' && reviewState !== 'replaced-old'

const findSnapshotMatchIndex = (input: {
  cursor: number
  nextSnapshot: DocxReplaySnapshot
  node: DocxReplayNode
  usedBlockIds: Set<string>
  reservedBlockIds?: ReadonlySet<string>
}): number => {
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

  for (let index = input.cursor; index < input.nextSnapshot.blocks.length; index += 1) {
    const block = input.nextSnapshot.blocks[index]
    if (
      input.usedBlockIds.has(block.blockId) ||
      input.reservedBlockIds?.has(block.blockId) ||
      block.kind !== input.node.kind
    ) {
      continue
    }
    const visualIdsMatch =
      input.node.visualIds.length === block.visuals.length &&
      input.node.visualIds.every(
        (visualId, visualIndex) => visualId === block.visuals[visualIndex]?.visualId
      )
    if (block.structureFingerprint === input.node.structureFingerprint && visualIdsMatch) {
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
    .filter((node): node is DocxReplayNode =>
      Boolean(node && isVisibleReviewState(node.reviewState))
    )
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
    node.structureFingerprint = matchedBlock.structureFingerprint
    node.visualIds = matchedBlock.visuals.map((visual) => visual.visualId)
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
    if (
      !candidate ||
      candidate.parentNodeId !== anchorNodeId ||
      !isVisibleReviewState(candidate.reviewState)
    ) {
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

const findVisibleNodeIdByBlockId = (
  session: DocxReplaySession,
  blockId: string
): string | undefined =>
  session.bodyNodeIds.find((nodeId) => {
    const node = session.nodeById.get(nodeId)
    return Boolean(
      node &&
      (node.currentBlockId === blockId ||
        node.blockId === blockId ||
        node.sourceBlockId === blockId) &&
      node.reviewState !== 'deleted' &&
      node.reviewState !== 'replaced-old'
    )
  })

const resolveBodyBlocksFromCreated = (
  snapshot: DocxReplaySnapshot,
  createdBlocks: DocxCreatedBlock[]
): DocxReplaySnapshotBlock[] => {
  const createdBodyIds = new Set(
    createdBlocks.filter((block) => block.type !== 'table_cell').map((block) => block.blockId)
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
    structureFingerprint: snapshotBlock.structureFingerprint,
    visualIds: snapshotBlock.visuals.map((visual) => visual.visualId),
    createdRevisionRef: revisionRef
  })

const resolveUniqueNodeId = (
  session: DocxReplaySession,
  candidate: string,
  reservedNodeIds: ReadonlySet<string> = new Set()
): string => {
  let nodeId = candidate
  let suffix = 2
  while (session.nodeById.has(nodeId) || reservedNodeIds.has(nodeId)) {
    nodeId = `${candidate}:${String(suffix)}`
    suffix += 1
  }
  return nodeId
}

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
  input.session.bodyNodeIds.splice(index, 1, input.oldNode.nodeId, input.newNode.nodeId)
  reindexBodyNodes(input.session)
}

const resolveSnapshotBlockForMutation = (input: {
  session: DocxReplaySession
  nextSnapshot: DocxReplaySnapshot
  createdBlocks: DocxCreatedBlock[]
  targetBlockId: string
  targetNode?: DocxReplayNode
}): DocxReplaySnapshotBlock | undefined => {
  const createdBodyBlocks = resolveBodyBlocksFromCreated(input.nextSnapshot, input.createdBlocks)
  if (createdBodyBlocks.length > 0) return createdBodyBlocks[0]
  const direct = input.nextSnapshot.blockById.get(input.targetBlockId)
  if (direct) return direct
  const tableBlockId = input.nextSnapshot.tableBlockIdByCellBlockId.get(input.targetBlockId)
  if (tableBlockId) return input.nextSnapshot.blockById.get(tableBlockId)
  const positional = input.targetNode
    ? input.nextSnapshot.blocks[input.targetNode.blockIndex]
    : undefined
  return positional?.kind === input.targetNode?.kind ? positional : undefined
}

export const createReplaySessionFromSnapshot = (input: {
  sourcePath: string
  targetMode?: DocxReplaySession['targetMode']
  sourceDocId: string
  meta: DocxReplaySession['meta']
  stats: DocxReplaySession['stats']
  diskFingerprint: DocxReplaySession['diskFingerprint']
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
      structureFingerprint: block.structureFingerprint,
      visualIds: block.visuals.map((visual) => visual.visualId),
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
    diskFingerprint: input.diskFingerprint,
    sourceSnapshot: input.snapshot,
    activeSnapshot: input.snapshot,
    docIdByRevisionRef: new Map([['v1', input.sourceDocId]]),
    revisionRefByDocId: new Map([[input.sourceDocId, 'v1']]),
    revisionByDocId: new Map(),
    nodeById,
    bodyNodeIds
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
      const node = buildCurrentNodeFromSnapshot(block, revisionRef, 'inserted', 'generated')
      session.nodeById.set(node.nodeId, node)
      return node.nodeId
    })
    insertNodeIds(session, undefined, insertedNodeIds, 'after')
    session.activeSnapshot = nextSnapshot
    return
  }

  const requestedTargetBlockId =
    op.type === 'update_table_cell' ||
    (op.type === 'replace_text' && Array.isArray(op.blockIds) && op.blockIds[0])
      ? op.type === 'update_table_cell'
        ? op.blockId
        : String(op.blockIds?.[0] || '')
      : 'blockId' in op
        ? String(op.blockId || '')
        : ''
  const targetBlockId =
    session.activeSnapshot.tableBlockIdByCellBlockId.get(requestedTargetBlockId) ||
    requestedTargetBlockId
  const targetNodeId = targetBlockId
    ? findVisibleNodeIdByBlockId(session, targetBlockId)
    : undefined
  const targetNodeIdsToSkip =
    targetNodeId &&
    (op.type === 'delete_block' ||
      op.type === 'replace_block' ||
      op.type === 'replace_text' ||
      op.type === 'style' ||
      op.type === 'update_table_cell')
      ? new Set([targetNodeId])
      : undefined
  const reservedBlockIds =
    op.type === 'insert_before' || op.type === 'insert_after'
      ? new Set(
          resolveBodyBlocksFromCreated(nextSnapshot, createdBlocks).map((block) => block.blockId)
        )
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
    insertNodeIds(
      session,
      anchorNodeId,
      insertedNodeIds,
      op.type === 'insert_before' ? 'before' : 'after'
    )
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

  if (op.type === 'style') {
    const snapshotBlock = resolveSnapshotBlockForMutation({
      session,
      nextSnapshot,
      createdBlocks,
      targetBlockId,
      targetNode
    })
    if (!snapshotBlock) {
      targetNode.reviewState = 'formatted'
      targetNode.changedRevisionRef = revisionRef
      targetNode.reviewQuery = op.target.type === 'text_match' ? op.target.query : undefined
      session.activeSnapshot = nextSnapshot
      return
    }

    targetNode.reviewState = 'formatted'
    targetNode.currentBlockId = snapshotBlock.blockId
    targetNode.blockIndex = snapshotBlock.blockIndex
    targetNode.spec = snapshotBlock.spec
    targetNode.structureFingerprint = snapshotBlock.structureFingerprint
    targetNode.visualIds = snapshotBlock.visuals.map((visual) => visual.visualId)
    targetNode.changedRevisionRef = revisionRef
    targetNode.reviewQuery = op.target.type === 'text_match' ? op.target.query : undefined
    session.activeSnapshot = nextSnapshot
    return
  }

  const oldState =
    op.type === 'replace_block' || op.type === 'replace_text' || op.type === 'update_table_cell'
      ? 'replaced-old'
      : 'deleted'

  const oldNode = cloneNodeAsOldRevision(targetNode, revisionRef, oldState)
  const snapshotBlock = resolveSnapshotBlockForMutation({
    session,
    nextSnapshot,
    createdBlocks,
    targetBlockId,
    targetNode
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
  oldNode.nodeId = resolveUniqueNodeId(session, oldNode.nodeId)
  newNode.nodeId = resolveUniqueNodeId(session, newNode.nodeId, new Set([oldNode.nodeId]))
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
  kind: 'review' | 'committed'
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
