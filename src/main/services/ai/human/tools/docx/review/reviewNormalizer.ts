import type { DocxBlockSpec, DocxReplayNode, DocxReplaySession } from '../types'

const isOldNode = (node: DocxReplayNode): boolean =>
  node.reviewState === 'deleted' || node.reviewState === 'replaced-old'

const specKey = (spec: DocxBlockSpec): string => JSON.stringify(spec)

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

const normalizeGeneratedNode = (node: DocxReplayNode): DocxReplayNode | null => {
  if (isOldNode(node)) return null
  return {
    ...node,
    nodeId: `net-inserted:${node.nodeId}`,
    reviewState: 'inserted',
    reviewQuery: undefined
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
        reviewState: 'deleted',
        reviewQuery: undefined
      }
    ]
  }

  if (specKey(baseline.spec) === specKey(visible.spec)) {
    return [
      {
        ...visible,
        nodeId: `net-normal:${input.sourceBlockId}`,
        sourceBlockId: input.sourceBlockId,
        reviewState: 'normal',
        reviewQuery: undefined
      }
    ]
  }

  if (textKey(baseline.spec) === textKey(visible.spec)) {
    return [
      {
        ...visible,
        nodeId: `net-formatted:${input.sourceBlockId}`,
        sourceBlockId: input.sourceBlockId,
        reviewState: 'formatted',
        reviewQuery: undefined
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
    reviewState: 'replaced-old',
    reviewQuery: undefined
  }
  const newNode: DocxReplayNode = {
    ...visible,
    nodeId: `net-replaced-new:${input.sourceBlockId}`,
    sourceBlockId: input.sourceBlockId,
    reviewState: 'replaced-new',
    reviewQuery: undefined,
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
