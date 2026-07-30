import type {
  DocxBlockSpec,
  DocxReplayNode,
  DocxReplaySession,
  DocxTableCellReviewChange,
  DocxTableSpec
} from '../types'

const isOldNode = (node: DocxReplayNode): boolean =>
  node.reviewState === 'deleted' || node.reviewState === 'replaced-old'

const specKey = (spec: DocxBlockSpec): string => JSON.stringify(spec)

const visualIdsEqual = (
  expected: Array<{ visualId: string }>,
  actual: readonly string[]
): boolean =>
  expected.length === actual.length &&
  expected.every((visual, index) => visual.visualId === actual[index])

const textKey = (spec: DocxBlockSpec): string => {
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
    nodeId: `net-inserted:${node.nodeId}`,
    reviewState: 'inserted',
    reviewQuery: undefined,
    tableCellChanges: undefined
  }
}

const normalizeSourceLineage = (input: {
  session: DocxReplaySession
  sourceBlockId: string
  nodes: DocxReplayNode[]
}): DocxReplayNode[] => {
  const baseline = input.session.sourceSnapshot.blockById.get(input.sourceBlockId)
  if (!baseline) return input.nodes
  const visible = input.nodes.filter((node) => !isOldNode(node)).at(-1)

  if (!visible) {
    const representative = input.nodes[0]
    return [
      {
        ...representative,
        nodeId: `net-deleted:${input.sourceBlockId}`,
        blockId: input.sourceBlockId,
        currentBlockId: undefined,
        sourceBlockId: input.sourceBlockId,
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
    visualsUnchanged &&
    baseline.structureFingerprint === visible.structureFingerprint &&
    specKey(baseline.spec) === specKey(visible.spec)
  ) {
    return [
      {
        ...visible,
        nodeId: `net-normal:${input.sourceBlockId}`,
        sourceBlockId: input.sourceBlockId,
        reviewState: 'normal',
        reviewQuery: undefined,
        tableCellChanges: undefined
      }
    ]
  }

  if (visualsUnchanged && baseline.spec.kind === 'table' && visible.spec.kind === 'table') {
    const tableCellChanges = buildTableCellChanges(baseline.spec, visible.spec)
    if (tableCellChanges && tableCellChanges.length > 0) {
      return [
        {
          ...visible,
          nodeId: `net-table-cells:${input.sourceBlockId}`,
          sourceBlockId: input.sourceBlockId,
          reviewState: 'formatted',
          reviewQuery: undefined,
          tableCellChanges
        }
      ]
    }
  }

  if (visualsUnchanged && textKey(baseline.spec) === textKey(visible.spec)) {
    return [
      {
        ...visible,
        nodeId: `net-formatted:${input.sourceBlockId}`,
        sourceBlockId: input.sourceBlockId,
        reviewState: 'formatted',
        reviewQuery: undefined,
        tableCellChanges: undefined
      }
    ]
  }

  const representative = input.nodes[0]
  const oldNode: DocxReplayNode = {
    ...representative,
    nodeId: `net-replaced-old:${input.sourceBlockId}`,
    blockId: input.sourceBlockId,
    currentBlockId: undefined,
    sourceBlockId: input.sourceBlockId,
    spec: baseline.spec,
    structureFingerprint: baseline.structureFingerprint,
    visualIds: baseline.visuals.map((visual) => visual.visualId),
    reviewState: 'replaced-old',
    reviewQuery: undefined,
    tableCellChanges: undefined
  }
  const newNode: DocxReplayNode = {
    ...visible,
    nodeId: `net-replaced-new:${input.sourceBlockId}`,
    sourceBlockId: input.sourceBlockId,
    reviewState: 'replaced-new',
    reviewQuery: undefined,
    tableCellChanges: undefined,
    replacedFromNodeId: oldNode.nodeId,
    predecessorNodeId: oldNode.nodeId
  }
  oldNode.successorNodeId = newNode.nodeId
  return [oldNode, newNode]
}

export const normalizeReviewNodes = (
  nodes: DocxReplayNode[],
  session: DocxReplaySession
): DocxReplayNode[] => {
  const sourceGroups = new Map<string, { firstIndex: number; nodes: DocxReplayNode[] }>()
  nodes.forEach((node, index) => {
    if (node.sourceOrigin !== 'source') return
    const sourceBlockId = node.sourceBlockId || node.blockId
    const group = sourceGroups.get(sourceBlockId)
    if (group) group.nodes.push(node)
    else sourceGroups.set(sourceBlockId, { firstIndex: index, nodes: [node] })
  })

  const output: DocxReplayNode[] = []
  nodes.forEach((node, index) => {
    if (node.sourceOrigin === 'generated') {
      const normalized = normalizeGeneratedNode(node)
      if (normalized) output.push(normalized)
      return
    }
    const sourceBlockId = node.sourceBlockId || node.blockId
    const group = sourceGroups.get(sourceBlockId)
    if (!group || group.firstIndex !== index) return
    output.push(
      ...normalizeSourceLineage({
        session,
        sourceBlockId,
        nodes: group.nodes
      })
    )
  })
  return output
}
