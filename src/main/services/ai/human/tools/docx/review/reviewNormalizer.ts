import type {
  DocxNodeSpec,
  DocxReplayNode,
  DocxReplaySession,
  DocxTableCellReviewChange,
  DocxTableSpec
} from '../types'

const isOldNode = (node: DocxReplayNode): boolean =>
  node.reviewState === 'deleted' || node.reviewState === 'replaced-old'

const specKey = (spec: DocxNodeSpec): string => JSON.stringify(spec)

const visualIdsEqual = (
  expected: Array<{ visualId: string }>,
  actual: readonly string[]
): boolean =>
  expected.length === actual.length &&
  expected.every((visual, index) => visual.visualId === actual[index])

const textKey = (spec: DocxNodeSpec): string => {
  if (spec.kind === 'paragraph') return spec.runs.map((run) => run.text).join('')
  return spec.rows
    .map((row) =>
      row
        .map((cell) =>
          cell.paragraphs
            .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
            .join('\n')
        )
        .join('\t')
    )
    .join('\n')
}

const tableShapeKey = (spec: DocxTableSpec): string => spec.rows.map((row) => row.length).join(',')

const buildTableCellChanges = (
  before: DocxTableSpec,
  after: DocxTableSpec
): DocxTableCellReviewChange[] | null => {
  if (tableShapeKey(before) !== tableShapeKey(after)) return null
  const changes: DocxTableCellReviewChange[] = []
  before.rows.forEach((row, rowIndex) => {
    row.forEach((beforeCell, colIndex) => {
      const afterCell = after.rows[rowIndex]?.[colIndex]
      if (
        !afterCell ||
        specKey({ kind: 'table', rows: [[beforeCell]] }) ===
          specKey({ kind: 'table', rows: [[afterCell]] })
      ) {
        return
      }
      const beforeText = textKey({ kind: 'table', rows: [[beforeCell]] })
      const afterText = textKey({ kind: 'table', rows: [[afterCell]] })
      changes.push({
        rowIndex,
        colIndex,
        kind: beforeText === afterText ? 'formatted' : 'replaced',
        before: beforeCell,
        after: afterCell
      })
    })
  })
  return changes
}

const normalizeGeneratedNode = (node: DocxReplayNode): DocxReplayNode | null => {
  if (isOldNode(node)) return null
  return {
    ...node,
    reviewId: `net-inserted:${node.nodeId}`,
    reviewState: 'inserted',
    reviewQuery: undefined,
    tableCellChanges: undefined
  }
}

const normalizeSourceLineage = (input: {
  session: DocxReplaySession
  sourceNodeId: string
  nodes: DocxReplayNode[]
  moved: boolean
}): DocxReplayNode[] => {
  const baseline = input.session.sourceSnapshot.nodeById.get(input.sourceNodeId)
  if (!baseline) return input.nodes
  const visible = input.nodes.filter((node) => !isOldNode(node)).at(-1)

  if (!visible) {
    const representative = input.nodes[0]
    return [
      {
        ...representative,
        reviewId: `net-deleted:${input.sourceNodeId}`,
        nodeId: input.sourceNodeId,
        currentNodeId: undefined,
        sourceNodeId: input.sourceNodeId,
        spec: baseline.spec,
        structureFingerprint: baseline.structureFingerprint,
        visualIds: baseline.visuals.map((visual) => visual.visualId),
        reviewState: 'deleted',
        reviewQuery: undefined,
        tableCellChanges: undefined
      }
    ]
  }

  const visualsUnchanged = visualIdsEqual(baseline.visuals, visible.visualIds)
  if (
    !input.moved &&
    visualsUnchanged &&
    baseline.structureFingerprint === visible.structureFingerprint &&
    specKey(baseline.spec) === specKey(visible.spec)
  ) {
    return [
      {
        ...visible,
        reviewId: `net-normal:${input.sourceNodeId}`,
        sourceNodeId: input.sourceNodeId,
        reviewState: 'normal',
        reviewQuery: undefined,
        tableCellChanges: undefined
      }
    ]
  }

  if (
    !input.moved &&
    visualsUnchanged &&
    baseline.spec.kind === 'table' &&
    visible.spec.kind === 'table'
  ) {
    const tableCellChanges = buildTableCellChanges(baseline.spec, visible.spec)
    if (tableCellChanges && tableCellChanges.length > 0) {
      return [
        {
          ...visible,
          reviewId: `net-table-cells:${input.sourceNodeId}`,
          sourceNodeId: input.sourceNodeId,
          reviewState: 'formatted',
          reviewQuery: undefined,
          tableCellChanges
        }
      ]
    }
  }

  if (!input.moved && visualsUnchanged && textKey(baseline.spec) === textKey(visible.spec)) {
    return [
      {
        ...visible,
        reviewId: `net-formatted:${input.sourceNodeId}`,
        sourceNodeId: input.sourceNodeId,
        reviewState: 'formatted',
        reviewQuery: undefined,
        tableCellChanges: undefined
      }
    ]
  }

  const representative = input.nodes[0]
  const oldNode: DocxReplayNode = {
    ...representative,
    reviewId: `net-replaced-old:${input.sourceNodeId}`,
    nodeId: input.sourceNodeId,
    currentNodeId: undefined,
    sourceNodeId: input.sourceNodeId,
    spec: baseline.spec,
    structureFingerprint: baseline.structureFingerprint,
    visualIds: baseline.visuals.map((visual) => visual.visualId),
    reviewState: 'replaced-old',
    reviewQuery: undefined,
    tableCellChanges: undefined
  }
  const newNode: DocxReplayNode = {
    ...visible,
    reviewId: `net-replaced-new:${input.sourceNodeId}`,
    sourceNodeId: input.sourceNodeId,
    reviewState: 'replaced-new',
    reviewQuery: undefined,
    tableCellChanges: undefined,
    replacedFromNodeId: oldNode.reviewId,
    predecessorNodeId: oldNode.reviewId
  }
  oldNode.successorNodeId = newNode.reviewId
  return [oldNode, newNode]
}

const movedSourceNodeIds = (nodes: DocxReplayNode[], session: DocxReplaySession): Set<string> => {
  const sourceIndex = new Map(
    session.sourceSnapshot.nodes.map((node, index) => [node.nodeId, index] as const)
  )
  const visible = nodes.filter((node) => node.sourceOrigin === 'source' && !isOldNode(node))
  const sequence = visible.map((node) => sourceIndex.get(node.sourceNodeId || node.nodeId) ?? -1)
  const tails: number[] = []
  const tailPositions: number[] = []
  const previous = sequence.map(() => -1)
  sequence.forEach((value, position) => {
    if (value < 0) return
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (tails[middle]! < value) low = middle + 1
      else high = middle
    }
    tails[low] = value
    previous[position] = low > 0 ? tailPositions[low - 1]! : -1
    tailPositions[low] = position
  })
  const stablePositions = new Set<number>()
  let cursor = tailPositions[tails.length - 1] ?? -1
  while (cursor >= 0) {
    stablePositions.add(cursor)
    cursor = previous[cursor] ?? -1
  }
  return new Set(
    visible
      .filter((_, index) => !stablePositions.has(index))
      .map((node) => node.sourceNodeId || node.nodeId)
  )
}

export const normalizeReviewNodes = (
  nodes: DocxReplayNode[],
  session: DocxReplaySession
): DocxReplayNode[] => {
  const movedNodeIds = movedSourceNodeIds(nodes, session)
  const sourceGroups = new Map<string, { firstIndex: number; nodes: DocxReplayNode[] }>()
  nodes.forEach((node, index) => {
    if (node.sourceOrigin !== 'source') return
    const sourceNodeId = node.sourceNodeId || node.nodeId
    const group = sourceGroups.get(sourceNodeId)
    if (group) group.nodes.push(node)
    else sourceGroups.set(sourceNodeId, { firstIndex: index, nodes: [node] })
  })

  const output: DocxReplayNode[] = []
  nodes.forEach((node, index) => {
    if (node.sourceOrigin === 'generated') {
      const normalized = normalizeGeneratedNode(node)
      if (normalized) output.push(normalized)
      return
    }
    const sourceNodeId = node.sourceNodeId || node.nodeId
    const group = sourceGroups.get(sourceNodeId)
    if (!group || group.firstIndex !== index) return
    output.push(
      ...normalizeSourceLineage({
        session,
        sourceNodeId,
        nodes: group.nodes,
        moved: movedNodeIds.has(sourceNodeId)
      })
    )
  })
  return output
}
