import type {
  DocxNodeSpec,
  DocxCreatedNode,
  DocxDetailedNode,
  DocxDetailedParagraphNode,
  DocxDetailedTableNode,
  DocxOperation,
  DocxOutlineNode,
  DocxReplayNode,
  DocxReplaySession,
  DocxReplaySnapshot,
  DocxReplaySnapshotNode,
  DocxReadNode,
  DocxReviewState
} from '../types'

const readParagraphRuns = (node: DocxDetailedParagraphNode) => {
  const runs: Extract<DocxNodeSpec, { kind: 'paragraph' }>['runs'] = []
  const visit = (childNode: DocxReadNode): void => {
    if (childNode.type === 'run') {
      const text = childNode.children
        .map((child) => {
          return child.type === 'text'
            ? child.text
            : child.type === 'tab'
              ? '\t'
              : child.type === 'break'
                ? '\n'
                : ''
        })
        .join('')
      if (text)
        runs.push({
          text,
          bold: childNode.style?.bold,
          italic: childNode.style?.italic,
          underline: childNode.style?.underline,
          color: childNode.style?.color
        })
      return
    }
    if (
      childNode.type === 'text' ||
      childNode.type === 'tab' ||
      childNode.type === 'break' ||
      childNode.type === 'bookmark' ||
      childNode.type === 'math'
    ) {
      return
    }
    childNode.children?.forEach(visit)
  }
  node.children.forEach(visit)
  return runs
}

const normalizeParagraphSpec = (
  node: DocxDetailedParagraphNode
): Extract<DocxNodeSpec, { kind: 'paragraph' }> => ({
  kind: 'paragraph',
  style: node.style?.styleName || 'Normal',
  runs: readParagraphRuns(node).length > 0 ? readParagraphRuns(node) : [{ text: node.text || '' }]
})

const normalizeTableSpec = (
  node: DocxDetailedTableNode
): Extract<DocxNodeSpec, { kind: 'table' }> => ({
  kind: 'table',
  rows: Array.from({ length: node.rows }, (_, rowIndex) =>
    Array.from({ length: node.cols }, (_, colIndex) => {
      const cell = node.children[rowIndex]?.children[colIndex]
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
                    nodeId: '',
                    nodeIndex: node.nodeIndex,
                    layoutMode: node.layoutMode,
                    story: node.story
                  })
                )
            : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
      }
    })
  )
})

export const detailedNodeToSpec = (node: DocxDetailedNode): DocxNodeSpec => {
  if (node.type === 'paragraph') return normalizeParagraphSpec(node)
  if (node.type === 'table') return normalizeTableSpec(node)
  return {
    kind: 'paragraph',
    style: 'Normal',
    runs: [{ text: node.text || '' }]
  }
}

const STRUCTURE_OMITTED_FIELDS = new Set([
  'nodeId',
  'visualId',
  'nodeIndex',
  'previousNodeId',
  'nextNodeId'
])

const structureFingerprint = (value: DocxDetailedNode | undefined): string =>
  JSON.stringify(value, (key, child) => (STRUCTURE_OMITTED_FIELDS.has(key) ? undefined : child))

const collectSnapshotVisuals = (
  value: DocxDetailedNode | undefined
): Array<{ visualId: string; kind: import('../types').DocxVisualKind }> => {
  const out: Array<{ visualId: string; kind: import('../types').DocxVisualKind }> = []
  const visit = (node: DocxReadNode | DocxDetailedNode): void => {
    if (node.type === 'visual') {
      out.push({ visualId: node.visualId, kind: node.kind })
      node.children?.forEach(visit)
      return
    }
    if (
      node.type === 'text' ||
      node.type === 'tab' ||
      node.type === 'break' ||
      node.type === 'bookmark' ||
      node.type === 'math'
    ) {
      return
    }
    node.children.forEach(visit)
  }
  if (value) visit(value)
  return out
}

export const createReplaySnapshot = (input: {
  packageFingerprint: string
  outlineNodes: DocxOutlineNode[]
  detailedNodesById: Map<string, DocxDetailedNode>
  rawXmlByNodeId: Map<string, string>
}): DocxReplaySnapshot => {
  const nodes: DocxReplaySnapshotNode[] = []
  const nodeById = new Map<string, DocxReplaySnapshotNode>()
  const tableNodeIdByCellNodeId = new Map<string, string>()

  input.outlineNodes.forEach((node) => {
    if (node.type === 'table_cell') {
      tableNodeIdByCellNodeId.set(node.nodeId, node.tableNodeId)
      return
    }

    const detail = input.detailedNodesById.get(node.nodeId)
    if (!detail || detail.type === 'table_cell') return

    const snapshotNode: DocxReplaySnapshotNode = {
      nodeId: node.nodeId,
      nodeIndex: node.nodeIndex,
      kind: detail.type,
      story: detail.story,
      rawXml: input.rawXmlByNodeId.get(node.nodeId) || '',
      spec: detailedNodeToSpec(detail),
      structureFingerprint: structureFingerprint(detail),
      visuals: collectSnapshotVisuals(detail),
      tableCellNodeIds:
        detail.type === 'table'
          ? input.outlineNodes
              .filter(
                (candidate) =>
                  candidate.type === 'table_cell' && candidate.tableNodeId === detail.nodeId
              )
              .map((cell) => cell.nodeId)
          : [],
      tableCells:
        detail.type === 'table'
          ? input.outlineNodes
              .filter(
                (candidate): candidate is Extract<DocxOutlineNode, { type: 'table_cell' }> =>
                  candidate.type === 'table_cell' && candidate.tableNodeId === detail.nodeId
              )
              .map((cell) => ({
                nodeId: cell.nodeId,
                row: cell.row,
                col: cell.col,
                text: cell.text,
                rawXml: input.rawXmlByNodeId.get(cell.nodeId) || '',
                structureFingerprint: structureFingerprint(input.detailedNodesById.get(cell.nodeId)),
                visuals: collectSnapshotVisuals(input.detailedNodesById.get(cell.nodeId))
              }))
          : undefined
    }

    nodes.push(snapshotNode)
    nodeById.set(snapshotNode.nodeId, snapshotNode)
    snapshotNode.tableCellNodeIds.forEach((cellNodeId) => {
      tableNodeIdByCellNodeId.set(cellNodeId, snapshotNode.nodeId)
    })
  })

  return {
    packageFingerprint: input.packageFingerprint,
    nodes,
    nodeById,
    tableNodeIdByCellNodeId
  }
}

export const createEmptyReplaySnapshot = (): DocxReplaySnapshot => ({
  packageFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  nodes: [],
  nodeById: new Map(),
  tableNodeIdByCellNodeId: new Map()
})

const buildNode = (input: {
  nodeId: string
  nodeIndex: number
  kind: 'paragraph' | 'table' | 'content_control' | 'revision'
  story: DocxReplayNode['story']
  sourceOrigin: 'source' | 'generated'
  reviewState: DocxReviewState
  parentNodeId?: string
  sourceNodeId?: string
  currentNodeId?: string
  spec: DocxNodeSpec
  structureFingerprint: string
  visualIds: string[]
  createdRevisionRef: string
  changedRevisionRef?: string
  reviewQuery?: string
}): DocxReplayNode => ({
  reviewId: `${input.reviewState}:${input.nodeId}:${input.createdRevisionRef}:${input.changedRevisionRef || 'active'}`,
  nodeId: input.nodeId,
  nodeIndex: input.nodeIndex,
  kind: input.kind,
  story: input.story,
  sourceOrigin: input.sourceOrigin,
  reviewState: input.reviewState,
  parentNodeId: input.parentNodeId,
  sourceNodeId: input.sourceNodeId,
  currentNodeId: input.currentNodeId,
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
    if (node) node.nodeIndex = index
  })
}

const isVisibleReviewState = (reviewState: DocxReviewState): boolean =>
  reviewState !== 'deleted' && reviewState !== 'replaced-old'

const findSnapshotMatchIndex = (input: {
  cursor: number
  nextSnapshot: DocxReplaySnapshot
  node: DocxReplayNode
  usedNodeIds: Set<string>
  reservedNodeIds?: ReadonlySet<string>
}): number => {
  for (let index = input.cursor; index < input.nextSnapshot.nodes.length; index += 1) {
    const node = input.nextSnapshot.nodes[index]
    if (
      input.usedNodeIds.has(node.nodeId) ||
      input.reservedNodeIds?.has(node.nodeId) ||
      node.kind !== input.node.kind
    ) {
      continue
    }
    if (
      node.nodeId === input.node.currentNodeId ||
      node.nodeId === input.node.nodeId ||
      (input.node.sourceNodeId && node.nodeId === input.node.sourceNodeId)
    ) {
      return index
    }
  }

  for (let index = input.cursor; index < input.nextSnapshot.nodes.length; index += 1) {
    const node = input.nextSnapshot.nodes[index]
    if (
      input.usedNodeIds.has(node.nodeId) ||
      input.reservedNodeIds?.has(node.nodeId) ||
      node.kind !== input.node.kind
    ) {
      continue
    }
    const visualIdsMatch =
      input.node.visualIds.length === node.visuals.length &&
      input.node.visualIds.every(
        (visualId, visualIndex) => visualId === node.visuals[visualIndex]?.visualId
      )
    if (node.structureFingerprint === input.node.structureFingerprint && visualIdsMatch) {
      return index
    }
  }

  return -1
}

const rebindVisibleNodesToSnapshot = (input: {
  session: DocxReplaySession
  nextSnapshot: DocxReplaySnapshot
  skipNodeIds?: ReadonlySet<string>
  reservedNodeIds?: ReadonlySet<string>
}): void => {
  const { nextSnapshot, session, skipNodeIds, reservedNodeIds } = input
  const visibleNodes = session.bodyNodeIds
    .map((nodeId) => session.nodeById.get(nodeId))
    .filter((node): node is DocxReplayNode =>
      Boolean(node && isVisibleReviewState(node.reviewState))
    )
  const usedNodeIds = new Set<string>()
  let cursor = 0

  visibleNodes.forEach((node) => {
    const matchIndex = findSnapshotMatchIndex({
      cursor,
      nextSnapshot,
      node,
      usedNodeIds,
      reservedNodeIds
    })
    if (matchIndex < 0) return

    const matchedNode = nextSnapshot.nodes[matchIndex]
    usedNodeIds.add(matchedNode.nodeId)
    cursor = matchIndex + 1
    if (skipNodeIds?.has(node.nodeId)) return
    node.currentNodeId = matchedNode.nodeId
    node.nodeIndex = matchedNode.nodeIndex
    node.spec = matchedNode.spec
    node.structureFingerprint = matchedNode.structureFingerprint
    node.visualIds = matchedNode.visuals.map((visual) => visual.visualId)
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

const findVisibleNodeIdByNodeId = (
  session: DocxReplaySession,
  nodeId: string
): string | undefined =>
  session.bodyNodeIds.find((reviewId) => {
    const node = session.nodeById.get(reviewId)
    return Boolean(
      node &&
      (node.currentNodeId === nodeId || node.nodeId === nodeId || node.sourceNodeId === nodeId) &&
      node.reviewState !== 'deleted' &&
      node.reviewState !== 'replaced-old'
    )
  })

const resolveBodyNodesFromCreated = (
  snapshot: DocxReplaySnapshot,
  createdNodes: DocxCreatedNode[]
): DocxReplaySnapshotNode[] => {
  const createdBodyIds = new Set(
    createdNodes.filter((node) => node.type !== 'table_cell').map((node) => node.nodeId)
  )
  return snapshot.nodes.filter((node) => createdBodyIds.has(node.nodeId))
}

const cloneNodeAsOldRevision = (
  node: DocxReplayNode,
  revisionRef: string,
  reviewState: 'deleted' | 'replaced-old'
): DocxReplayNode => ({
  ...node,
  nodeId: `${node.nodeId}:${reviewState}:${revisionRef}`,
  currentNodeId: undefined,
  reviewState,
  successorNodeId: undefined,
  changedRevisionRef: revisionRef,
  reviewQuery: undefined
})

const buildCurrentNodeFromSnapshot = (
  snapshotNode: DocxReplaySnapshotNode,
  revisionRef: string,
  reviewState: 'inserted' | 'replaced-new',
  sourceOrigin: 'source' | 'generated',
  sourceNodeId?: string,
  parentNodeId?: string
): DocxReplayNode =>
  buildNode({
    nodeId: snapshotNode.nodeId,
    nodeIndex: snapshotNode.nodeIndex,
    kind: snapshotNode.kind,
    story: snapshotNode.story,
    sourceOrigin,
    reviewState,
    parentNodeId,
    sourceNodeId,
    currentNodeId: snapshotNode.nodeId,
    spec: snapshotNode.spec,
    structureFingerprint: snapshotNode.structureFingerprint,
    visualIds: snapshotNode.visuals.map((visual) => visual.visualId),
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

const resolveSnapshotNodeForMutation = (input: {
  session: DocxReplaySession
  nextSnapshot: DocxReplaySnapshot
  createdNodes: DocxCreatedNode[]
  targetNodeId: string
  targetNode?: DocxReplayNode
}): DocxReplaySnapshotNode | undefined => {
  const createdBodyNodes = resolveBodyNodesFromCreated(input.nextSnapshot, input.createdNodes)
  if (createdBodyNodes.length > 0) return createdBodyNodes[0]
  const direct = input.nextSnapshot.nodeById.get(input.targetNodeId)
  if (direct) return direct
  const tableNodeId = input.nextSnapshot.tableNodeIdByCellNodeId.get(input.targetNodeId)
  if (tableNodeId) return input.nextSnapshot.nodeById.get(tableNodeId)
  const positional = input.targetNode
    ? input.nextSnapshot.nodes[input.targetNode.nodeIndex]
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

  input.snapshot.nodes.forEach((snapshotNode) => {
    const reviewNode = buildNode({
      nodeId: snapshotNode.nodeId,
      nodeIndex: snapshotNode.nodeIndex,
      kind: snapshotNode.kind,
      story: snapshotNode.story,
      sourceOrigin: 'source',
      reviewState: 'normal',
      sourceNodeId: snapshotNode.nodeId,
      currentNodeId: snapshotNode.nodeId,
      spec: snapshotNode.spec,
      structureFingerprint: snapshotNode.structureFingerprint,
      visualIds: snapshotNode.visuals.map((visual) => visual.visualId),
      createdRevisionRef: 'v1'
    })
    nodeById.set(reviewNode.reviewId, reviewNode)
    bodyNodeIds.push(reviewNode.reviewId)
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
  op: DocxOperation
  createdNodes: DocxCreatedNode[]
  nextSnapshot: DocxReplaySnapshot
}): void => {
  const { session, revisionRef, op, createdNodes, nextSnapshot } = input
  if (op.type === 'create_document') {
    const createdBodyNodes = resolveBodyNodesFromCreated(nextSnapshot, createdNodes)
    const insertedNodeIds = createdBodyNodes.map((snapshotNode) => {
      const reviewNode = buildCurrentNodeFromSnapshot(
        snapshotNode,
        revisionRef,
        'inserted',
        'generated'
      )
      session.nodeById.set(reviewNode.reviewId, reviewNode)
      return reviewNode.reviewId
    })
    insertNodeIds(session, undefined, insertedNodeIds, 'after')
    session.activeSnapshot = nextSnapshot
    return
  }

  if (op.type === 'move_node' && (op.position === 'before' || op.position === 'after')) {
    const movingNodeId = findVisibleNodeIdByNodeId(session, op.nodeId)
    const anchorNodeId = findVisibleNodeIdByNodeId(session, op.anchorNodeId)
    if (movingNodeId && anchorNodeId && movingNodeId !== anchorNodeId) {
      const movingIndex = session.bodyNodeIds.indexOf(movingNodeId)
      if (movingIndex >= 0) session.bodyNodeIds.splice(movingIndex, 1)
      const anchorIndex = session.bodyNodeIds.indexOf(anchorNodeId)
      if (anchorIndex >= 0) {
        session.bodyNodeIds.splice(anchorIndex + (op.position === 'after' ? 1 : 0), 0, movingNodeId)
        reindexBodyNodes(session)
      }
    }
  }

  const requestedTargetNodeId =
    'nodeId' in op && op.nodeId ? op.nodeId : 'tableNodeId' in op ? op.tableNodeId : ''
  const targetDocumentNodeId =
    session.activeSnapshot.tableNodeIdByCellNodeId.get(requestedTargetNodeId) ||
    requestedTargetNodeId
  const targetNodeId = targetDocumentNodeId
    ? findVisibleNodeIdByNodeId(session, targetDocumentNodeId)
    : undefined
  const targetNodeIdsToSkip =
    targetNodeId &&
    (op.type === 'delete_node' ||
      op.type === 'delete_table' ||
      op.type === 'replace_node' ||
      op.type === 'replace_text' ||
      op.type.startsWith('format_') ||
      op.type === 'apply_named_style' ||
      op.type === 'reset_format')
      ? new Set([targetNodeId])
      : undefined
  const reservedNodeIds =
    op.type === 'insert_nodes' || op.type === 'create_table' || op.type === 'insert_image'
      ? new Set(resolveBodyNodesFromCreated(nextSnapshot, createdNodes).map((node) => node.nodeId))
      : undefined

  rebindVisibleNodesToSnapshot({
    session,
    nextSnapshot,
    skipNodeIds: targetNodeIdsToSkip,
    reservedNodeIds
  })

  if (op.type === 'insert_nodes' || op.type === 'create_table' || op.type === 'insert_image') {
    const documentAnchorId = 'nodeId' in op ? op.nodeId : undefined
    const anchorNodeId = documentAnchorId
      ? findVisibleNodeIdByNodeId(session, documentAnchorId)
      : undefined
    const position = op.position === 'before' ? 'before' : 'after'
    const createdBodyNodes = resolveBodyNodesFromCreated(nextSnapshot, createdNodes)
    const insertedNodeIds = createdBodyNodes.map((snapshotNode) => {
      const reviewNode = buildCurrentNodeFromSnapshot(
        snapshotNode,
        revisionRef,
        'inserted',
        'generated',
        undefined,
        anchorNodeId
      )
      reviewNode.anchorFromNodeId = anchorNodeId
      reviewNode.anchorSide = position
      session.nodeById.set(reviewNode.reviewId, reviewNode)
      return reviewNode.reviewId
    })
    insertNodeIds(session, anchorNodeId, insertedNodeIds, position)
    session.activeSnapshot = nextSnapshot
    return
  }

  if (op.type === 'delete_node' || op.type === 'delete_table') {
    const documentNodeId = op.type === 'delete_table' ? op.tableNodeId : op.nodeId
    const targetNodeId = findVisibleNodeIdByNodeId(session, documentNodeId)
    if (targetNodeId) {
      const targetNode = session.nodeById.get(targetNodeId)
      if (targetNode) {
        targetNode.reviewState = 'deleted'
        targetNode.currentNodeId = undefined
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

  if (
    op.type === 'format_text' ||
    op.type === 'format_paragraph' ||
    op.type === 'format_table' ||
    op.type === 'format_row' ||
    op.type === 'format_cell' ||
    op.type === 'format_section' ||
    op.type === 'reset_format' ||
    op.type === 'apply_named_style' ||
    op.type === 'set_numbering'
  ) {
    const snapshotNode = resolveSnapshotNodeForMutation({
      session,
      nextSnapshot,
      createdNodes,
      targetNodeId,
      targetNode
    })
    if (!snapshotNode) {
      targetNode.reviewState = 'formatted'
      targetNode.changedRevisionRef = revisionRef
      targetNode.reviewQuery = op.type === 'format_text' ? op.text : undefined
      session.activeSnapshot = nextSnapshot
      return
    }

    targetNode.reviewState = 'formatted'
    targetNode.currentNodeId = snapshotNode.nodeId
    targetNode.nodeIndex = snapshotNode.nodeIndex
    targetNode.spec = snapshotNode.spec
    targetNode.structureFingerprint = snapshotNode.structureFingerprint
    targetNode.visualIds = snapshotNode.visuals.map((visual) => visual.visualId)
    targetNode.changedRevisionRef = revisionRef
    targetNode.reviewQuery = op.type === 'format_text' ? op.text : undefined
    session.activeSnapshot = nextSnapshot
    return
  }

  const oldState =
    op.type === 'replace_node' || op.type === 'replace_text' ? 'replaced-old' : 'deleted'

  const oldNode = cloneNodeAsOldRevision(targetNode, revisionRef, oldState)
  const snapshotNode = resolveSnapshotNodeForMutation({
    session,
    nextSnapshot,
    createdNodes,
    targetNodeId,
    targetNode
  })

  if (!snapshotNode) {
    targetNode.reviewState = oldState
    targetNode.currentNodeId = undefined
    targetNode.changedRevisionRef = revisionRef
    session.activeSnapshot = nextSnapshot
    return
  }

  const newNode = buildCurrentNodeFromSnapshot(
    snapshotNode,
    revisionRef,
    'replaced-new',
    targetNode.sourceOrigin,
    targetNode.sourceNodeId
  )
  oldNode.reviewId = resolveUniqueNodeId(session, oldNode.reviewId)
  newNode.reviewId = resolveUniqueNodeId(session, newNode.reviewId, new Set([oldNode.reviewId]))
  oldNode.successorNodeId = newNode.reviewId
  newNode.predecessorNodeId = oldNode.reviewId
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
