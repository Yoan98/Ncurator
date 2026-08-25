import { createHash, randomUUID } from 'node:crypto'
import { XMLSerializer } from '@xmldom/xmldom'
import type {
  DocxCreateContainerChildNode,
  DocxChangedNode,
  DocxDetailedNode,
  DocxReadNode,
  DocxOperation,
  DocxOutlineNode,
  DocxSearchMatch
} from '../types'
import type { NodeIndex, IndexedNode } from '../adapters/ooxml/types'
import { childElements } from '../adapters/ooxml/dom'

export type DocxIdentityIndex = {
  publicIdByInternalId: Map<string, string>
  internalIdByPublicId: Map<string, string>
  publicNodeIdByInternalId: Map<string, string>
  internalNodeIdByPublicId: Map<string, string>
  publicVisualIdByInternalId: Map<string, string>
  internalVisualIdByPublicId: Map<string, string>
}

type LogicalBodyNode = {
  nodeId: string
  kind: 'paragraph' | 'table' | 'content_control' | 'revision'
  cellNodeIds: string[]
}

const isTableCellNode = (node: IndexedNode): node is Extract<IndexedNode, { kind: 'table_cell' }> =>
  node.kind === 'table_cell'

const createNodeId = (): string => `node_${randomUUID().replace(/-/g, '')}`
const stableNestedId = (prefix: 'node' | 'visual', nodeId: string, relativeKey: string): string =>
  `${prefix}_${createHash('sha256').update(`${nodeId}\u0000${relativeKey}`).digest('hex').slice(0, 24)}`

const bindIdentity = (
  identity: DocxIdentityIndex,
  internalId: string,
  publicId = createNodeId()
): string => {
  identity.publicIdByInternalId.set(internalId, publicId)
  identity.internalIdByPublicId.set(publicId, internalId)
  return publicId
}

export const createInitialIdentityIndex = (index: NodeIndex): DocxIdentityIndex => {
  const identity: DocxIdentityIndex = {
    publicIdByInternalId: new Map(),
    internalIdByPublicId: new Map(),
    publicNodeIdByInternalId: new Map(),
    internalNodeIdByPublicId: new Map(),
    publicVisualIdByInternalId: new Map(),
    internalVisualIdByPublicId: new Map()
  }
  for (const internalId of index.nodesById.keys()) bindIdentity(identity, internalId)
  bindNestedIdentities(index, identity)
  return identity
}

const nestedFingerprint = (
  editable: NodeIndex['editableNodesById'] extends Map<string, infer TValue> ? TValue : never
): string =>
  createHash('sha256')
    .update(editable.kind)
    .update('\0')
    .update(new XMLSerializer().serializeToString(editable.node))
    .digest('hex')

const bindNestedIdentities = (
  index: NodeIndex,
  identity: DocxIdentityIndex,
  previousIndex?: NodeIndex,
  previousIdentity?: DocxIdentityIndex
): void => {
  const previousByFingerprint = new Map<string, Array<{ internalId: string; publicId: string }>>()
  const previousByPath = new Map<string, { internalId: string; publicId: string }>()
  if (previousIndex && previousIdentity) {
    previousIndex.editableNodesById.forEach((editable, internalNodeId) => {
      const publicId = previousIdentity.publicNodeIdByInternalId.get(internalNodeId)
      const rootPublicId = previousIdentity.publicIdByInternalId.get(editable.ownerNodeId)
      if (!publicId || !rootPublicId) return
      const relativeKey = internalNodeId.replace(`node:${editable.ownerNodeId}:`, '')
      const fingerprintKey = `${rootPublicId}\0${nestedFingerprint(editable)}`
      const candidates = previousByFingerprint.get(fingerprintKey) || []
      candidates.push({ internalId: internalNodeId, publicId })
      previousByFingerprint.set(fingerprintKey, candidates)
      previousByPath.set(`${rootPublicId}\0${editable.kind}\0${relativeKey}`, {
        internalId: internalNodeId,
        publicId
      })
    })
  }
  const consumedPreviousIds = new Set<string>()
  const pending = [...index.editableNodesById.entries()].map(([internalNodeId, editable]) => ({
    internalNodeId,
    editable,
    ownerPublicId: requirePublicNodeId(identity, editable.ownerNodeId),
    relativeKey: internalNodeId.replace(`node:${editable.ownerNodeId}:`, ''),
    publicNodeId: undefined as string | undefined
  }))
  pending.forEach((entry) => {
    const fingerprintCandidates = previousByFingerprint.get(
      `${entry.ownerPublicId}\0${nestedFingerprint(entry.editable)}`
    )
    const fingerprintMatch = fingerprintCandidates?.find(
      (candidate) => !consumedPreviousIds.has(candidate.internalId)
    )
    if (!fingerprintMatch) return
    consumedPreviousIds.add(fingerprintMatch.internalId)
    entry.publicNodeId = fingerprintMatch.publicId
  })
  pending.forEach((entry) => {
    if (entry.publicNodeId) return
    const pathMatch = previousByPath.get(
      `${entry.ownerPublicId}\0${entry.editable.kind}\0${entry.relativeKey}`
    )
    if (!pathMatch || consumedPreviousIds.has(pathMatch.internalId)) return
    consumedPreviousIds.add(pathMatch.internalId)
    entry.publicNodeId = pathMatch.publicId
  })
  pending.forEach((entry) => {
    const publicNodeId = entry.publicNodeId || createNodeId()
    identity.publicNodeIdByInternalId.set(entry.internalNodeId, publicNodeId)
    identity.internalNodeIdByPublicId.set(publicNodeId, entry.internalNodeId)
  })
  const previousVisualByFingerprint = new Map<
    string,
    Array<{ internalId: string; publicId: string }>
  >()
  if (previousIndex && previousIdentity) {
    previousIndex.visualsById.forEach((visual, internalVisualId) => {
      const publicId = previousIdentity.publicVisualIdByInternalId.get(internalVisualId)
      const rootPublicId = previousIdentity.publicIdByInternalId.get(visual.ownerNodeId)
      if (!publicId || !rootPublicId) return
      const key = `${rootPublicId}\0${visual.kind}\0${visual.relationshipId || ''}`
      const candidates = previousVisualByFingerprint.get(key) || []
      candidates.push({ internalId: internalVisualId, publicId })
      previousVisualByFingerprint.set(key, candidates)
    })
  }
  const consumedVisualIds = new Set<string>()
  index.visualsById.forEach((visual, internalVisualId) => {
    const publicNodeId = requirePublicNodeId(identity, visual.ownerNodeId)
    const relativeKey = internalVisualId.replace(`visual:${visual.ownerNodeId}:`, '')
    const candidates = previousVisualByFingerprint.get(
      `${publicNodeId}\0${visual.kind}\0${visual.relationshipId || ''}`
    )
    const preserved = candidates?.find((candidate) => !consumedVisualIds.has(candidate.internalId))
    if (preserved) consumedVisualIds.add(preserved.internalId)
    const publicVisualId =
      preserved?.publicId || stableNestedId('visual', publicNodeId, relativeKey)
    identity.publicVisualIdByInternalId.set(internalVisualId, publicVisualId)
    identity.internalVisualIdByPublicId.set(publicVisualId, internalVisualId)
  })
}

export const resolveInternalNodeId = (identity: DocxIdentityIndex, publicId: string): string => {
  const internalId =
    identity.internalIdByPublicId.get(publicId) || identity.internalNodeIdByPublicId.get(publicId)
  if (!internalId)
    throw new Error(`stale or unknown docx nodeId: ${publicId}; read the document again`)
  return internalId
}

export const resolveInternalVisualId = (identity: DocxIdentityIndex, publicId: string): string => {
  const internalId = identity.internalVisualIdByPublicId.get(publicId)
  if (!internalId)
    throw new Error(`stale or unknown docx visualId: ${publicId}; read the node again`)
  return internalId
}

const resolvePublicNodeId = (
  identity: DocxIdentityIndex,
  internalId: string | undefined
): string | undefined => {
  if (!internalId) return undefined
  return identity.publicIdByInternalId.get(internalId)
}

const requirePublicNodeId = (identity: DocxIdentityIndex, internalId: string): string => {
  const publicId = resolvePublicNodeId(identity, internalId)
  if (!publicId) throw new Error(`docx identity missing for internal node: ${internalId}`)
  return publicId
}

const mapNeighborFields = <T extends { previousNodeId?: string; nextNodeId?: string }>(
  identity: DocxIdentityIndex,
  value: T
): T => ({
  ...value,
  previousNodeId: resolvePublicNodeId(identity, value.previousNodeId),
  nextNodeId: resolvePublicNodeId(identity, value.nextNodeId)
})

export const toPublicOutlineNode = (
  identity: DocxIdentityIndex,
  node: DocxOutlineNode
): DocxOutlineNode => {
  const mapped = mapNeighborFields(identity, node)
  if (mapped.type === 'table_cell') {
    return {
      ...mapped,
      nodeId: requirePublicNodeId(identity, mapped.nodeId),
      tableNodeId: requirePublicNodeId(identity, mapped.tableNodeId)
    }
  }
  return {
    ...mapped,
    nodeId: requirePublicNodeId(identity, mapped.nodeId)
  }
}

const toPublicReadNode = (identity: DocxIdentityIndex, node: DocxReadNode): DocxReadNode => {
  const mappedChildren =
    'children' in node && node.children
      ? node.children.map((child) => toPublicReadNode(identity, child))
      : undefined
  if (node.type === 'visual') {
    const publicVisualId = identity.publicVisualIdByInternalId.get(node.visualId)
    if (!publicVisualId) throw new Error(`docx identity missing for visual: ${node.visualId}`)
    return { ...node, visualId: publicVisualId, children: mappedChildren as typeof node.children }
  }
  if (node.type === 'table_cell') {
    const publicNodeId = identity.publicIdByInternalId.get(node.nodeId)
    if (publicNodeId) {
      return { ...node, nodeId: publicNodeId, children: mappedChildren as typeof node.children }
    }
  }
  if ('nodeId' in node && node.nodeId) {
    const publicNodeId = identity.publicNodeIdByInternalId.get(node.nodeId)
    if (!publicNodeId) throw new Error(`docx identity missing for node: ${node.nodeId}`)
    return { ...node, nodeId: publicNodeId, children: mappedChildren } as DocxReadNode
  }
  if (mappedChildren) return { ...node, children: mappedChildren } as DocxReadNode
  return node
}

export const toPublicDetailedNode = (
  identity: DocxIdentityIndex,
  node: DocxDetailedNode
): DocxDetailedNode => {
  const mapped = mapNeighborFields(identity, node)
  if (mapped.type === 'paragraph') {
    return {
      ...mapped,
      nodeId: requirePublicNodeId(identity, mapped.nodeId),
      children: mapped.children.map((child) =>
        toPublicReadNode(identity, child)
      ) as typeof mapped.children
    }
  }
  if (mapped.type === 'table_cell') {
    return {
      ...mapped,
      nodeId: requirePublicNodeId(identity, mapped.nodeId),
      tableNodeId: requirePublicNodeId(identity, mapped.tableNodeId),
      children: mapped.children.map((child) =>
        toPublicReadNode(identity, child)
      ) as typeof mapped.children
    }
  }
  if (mapped.type === 'table') {
    return {
      ...mapped,
      nodeId: requirePublicNodeId(identity, mapped.nodeId),
      children: mapped.children.map((child) =>
        toPublicReadNode(identity, child)
      ) as typeof mapped.children
    }
  }
  if (mapped.type === 'content_control') {
    return {
      ...mapped,
      nodeId: requirePublicNodeId(identity, mapped.nodeId),
      children: mapped.children.map((child) =>
        toPublicReadNode(identity, child)
      ) as typeof mapped.children
    }
  }
  return {
    ...mapped,
    nodeId: requirePublicNodeId(identity, mapped.nodeId),
    children: mapped.children.map((child) =>
      toPublicReadNode(identity, child)
    ) as typeof mapped.children
  }
}

export const toPublicSearchMatch = (
  identity: DocxIdentityIndex,
  match: DocxSearchMatch
): DocxSearchMatch => ({
  ...mapNeighborFields(identity, match),
  nodeId: requirePublicNodeId(identity, match.nodeId),
  tableNodeId: resolvePublicNodeId(identity, match.tableNodeId)
})

export const toInternalOp = (identity: DocxIdentityIndex, op: DocxOperation): DocxOperation => {
  if (op.type === 'create_document') return op
  if (op.type === 'replace_text' || op.type === 'replace_node' || op.type === 'delete_node') {
    return { ...op, nodeId: resolveInternalNodeId(identity, op.nodeId) }
  }
  if (op.type === 'insert_nodes') {
    return {
      ...op,
      nodeId: op.nodeId ? resolveInternalNodeId(identity, op.nodeId) : undefined
    }
  }
  if (op.type === 'move_node') {
    return {
      ...op,
      nodeId: resolveInternalNodeId(identity, op.nodeId),
      anchorNodeId: resolveInternalNodeId(identity, op.anchorNodeId)
    }
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
    return { ...op, nodeId: resolveInternalNodeId(identity, op.nodeId) }
  }
  if (op.type === 'create_table') {
    return {
      ...op,
      nodeId: op.nodeId ? resolveInternalNodeId(identity, op.nodeId) : undefined
    }
  }
  if (op.type === 'delete_table') {
    return { ...op, tableNodeId: resolveInternalNodeId(identity, op.tableNodeId) }
  }
  if (
    op.type === 'insert_row' ||
    op.type === 'insert_column' ||
    op.type === 'delete_column' ||
    op.type === 'merge_cells'
  ) {
    return {
      ...op,
      tableNodeId: resolveInternalNodeId(identity, op.tableNodeId),
      ...(op.type === 'insert_row' && op.rowNodeId
        ? { rowNodeId: resolveInternalNodeId(identity, op.rowNodeId) }
        : {})
    }
  }
  if (op.type === 'delete_row') {
    return { ...op, rowNodeId: resolveInternalNodeId(identity, op.rowNodeId) }
  }
  if (op.type === 'split_cell') {
    return { ...op, cellNodeId: resolveInternalNodeId(identity, op.cellNodeId) }
  }
  if (op.type === 'insert_image') {
    return {
      ...op,
      nodeId: op.nodeId ? resolveInternalNodeId(identity, op.nodeId) : undefined
    }
  }
  if (op.type === 'replace_image' || op.type === 'delete_media' || op.type === 'update_image') {
    return { ...op, visualId: resolveInternalVisualId(identity, op.visualId) }
  }
  if (op.type === 'add_comment') {
    return { ...op, nodeId: resolveInternalNodeId(identity, op.nodeId) }
  }
  if (
    op.type === 'create_named_style' ||
    op.type === 'update_named_style' ||
    op.type === 'delete_named_style' ||
    op.type === 'update_comment' ||
    op.type === 'reply_comment' ||
    op.type === 'delete_comment' ||
    op.type === 'enable_track_changes' ||
    op.type === 'disable_track_changes' ||
    op.type === 'accept_revision' ||
    op.type === 'reject_revision' ||
    op.type === 'accept_all_revisions' ||
    op.type === 'reject_all_revisions'
  ) {
    return op
  }
  return op
}

const tableCellCount = (spec: Extract<DocxCreateContainerChildNode, { type: 'table' }>): number =>
  spec.children.reduce((total, row) => total + row.children.length, 0)

const logicalNodeFromSpec = (
  spec: DocxCreateContainerChildNode,
  nodeId = createNodeId()
): LogicalBodyNode => ({
  nodeId,
  kind: spec.type,
  cellNodeIds:
    spec.type === 'table' ? Array.from({ length: tableCellCount(spec) }, () => createNodeId()) : []
})

const currentLogicalBody = (index: NodeIndex, identity: DocxIdentityIndex): LogicalBodyNode[] =>
  index.bodyNodeIds.map((internalId) => {
    const node = index.nodesById.get(internalId)
    if (!node || node.kind === 'table_cell') {
      throw new Error(`invalid docx body identity node: ${internalId}`)
    }
    const cellNodeIds =
      node.kind === 'table'
        ? [...index.nodesById.values()]
            .filter(isTableCellNode)
            .filter((candidate) => candidate.tableNodeId === internalId)
            .sort((left, right) => left.row - right.row || left.col - right.col)
            .map((cell) => requirePublicNodeId(identity, cell.nodeId))
        : []
    return {
      nodeId: requirePublicNodeId(identity, internalId),
      kind: node.kind,
      cellNodeIds
    }
  })

const tableMutationContext = (input: {
  body: LogicalBodyNode[]
  op: DocxOperation
  previousIndex: NodeIndex
  previousIdentity: DocxIdentityIndex
}): { logical: LogicalBodyNode; rows: string[][]; table: Element } | undefined => {
  let publicTableId: string | undefined
  if ('tableNodeId' in input.op && typeof input.op.tableNodeId === 'string') {
    publicTableId = input.op.tableNodeId
  } else {
    const targetId =
      input.op.type === 'delete_row'
        ? input.op.rowNodeId
        : input.op.type === 'split_cell'
          ? input.op.cellNodeId
          : undefined
    const internalTarget = targetId
      ? input.previousIdentity.internalNodeIdByPublicId.get(targetId)
      : undefined
    let node = internalTarget
      ? input.previousIndex.editableNodesById.get(internalTarget)?.node
      : undefined
    while (node && node.localName !== 'tbl') node = node.parentNode as Element | undefined
    const internalTableId = node
      ? [...input.previousIndex.nodesById.values()].find((candidate) => candidate.node === node)
          ?.nodeId
      : undefined
    publicTableId = internalTableId
      ? input.previousIdentity.publicIdByInternalId.get(internalTableId)
      : undefined
  }
  if (!publicTableId) return undefined
  const logical = input.body.find((candidate) => candidate.nodeId === publicTableId)
  const internalTableId = input.previousIdentity.internalIdByPublicId.get(publicTableId)
  const table = internalTableId
    ? input.previousIndex.nodesById.get(internalTableId)?.node
    : undefined
  if (!logical || !table) return undefined
  const physicalRows = childElements(table, 'tr')
  let cursor = 0
  const rows = physicalRows.map((row) => {
    const count = childElements(row, 'tc').length
    const ids = logical.cellNodeIds.slice(cursor, cursor + count)
    cursor += count
    return ids
  })
  return { logical, rows, table }
}

const applyLogicalOp = (
  body: LogicalBodyNode[],
  op: DocxOperation,
  previousIndex: NodeIndex,
  previousIdentity: DocxIdentityIndex
): void => {
  if (
    op.type === 'create_document' ||
    op.type === 'replace_text' ||
    op.type.startsWith('format_') ||
    op.type === 'reset_format' ||
    op.type === 'apply_named_style' ||
    op.type === 'create_named_style' ||
    op.type === 'update_named_style' ||
    op.type === 'delete_named_style' ||
    op.type === 'set_numbering'
  ) {
    return
  }
  if (op.type === 'insert_nodes') {
    const paragraphNodes = op.nodes.filter((node) => node.type === 'paragraph')
    if (paragraphNodes.length === 0) return
    if (paragraphNodes.length !== op.nodes.length) return
    if (op.position === 'document_end') {
      body.push(
        ...paragraphNodes.map(() =>
          logicalNodeFromSpec({
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: '' }] }]
          })
        )
      )
      return
    }
    if (!op.nodeId || !previousIndex.nodesById.has(op.nodeId)) return
    if (op.position !== 'before' && op.position !== 'after') return
    const anchorIndex = body.findIndex((candidate) => candidate.nodeId === op.nodeId)
    if (anchorIndex < 0) return
    const inserted = paragraphNodes.map(() =>
      logicalNodeFromSpec({
        type: 'paragraph',
        children: [{ type: 'run', children: [{ type: 'text', text: '' }] }]
      })
    )
    body.splice(anchorIndex + (op.position === 'after' ? 1 : 0), 0, ...inserted)
    return
  }
  if (op.type === 'delete_node') {
    const targetIndex = body.findIndex((candidate) => candidate.nodeId === op.nodeId)
    if (targetIndex >= 0) body.splice(targetIndex, 1)
    return
  }
  if (op.type === 'replace_node') {
    const targetIndex = body.findIndex((candidate) => candidate.nodeId === op.nodeId)
    if (targetIndex < 0) return
    if (op.node.type !== 'paragraph') {
      throw new Error('a body paragraph can only be replaced by another node node')
    }
    return
  }

  if (op.type === 'create_table') {
    const table = logicalNodeFromSpec({
      type: 'table',
      children: op.rows.map((row) => ({
        type: 'table_row',
        children: row.map(() => ({
          type: 'table_cell',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', children: [{ type: 'text', text: '' }] }]
            }
          ]
        }))
      }))
    })
    if (op.position === 'document_end') {
      body.push(table)
      return
    }
    if (!op.nodeId) return
    const anchorIndex = body.findIndex((node) => node.nodeId === op.nodeId)
    if (anchorIndex < 0) return
    body.splice(anchorIndex + (op.position === 'after' ? 1 : 0), 0, table)
    return
  }
  if (op.type === 'delete_table') {
    const targetIndex = body.findIndex((node) => node.nodeId === op.tableNodeId)
    if (targetIndex >= 0) body.splice(targetIndex, 1)
    return
  }

  if (
    op.type === 'insert_row' ||
    op.type === 'delete_row' ||
    op.type === 'insert_column' ||
    op.type === 'delete_column' ||
    op.type === 'merge_cells' ||
    op.type === 'split_cell'
  ) {
    const context = tableMutationContext({ body, op, previousIndex, previousIdentity })
    if (!context) throw new Error(`cannot update DOCX table identity for ${op.type}`)
    const { rows, table } = context
    if (op.type === 'insert_row') {
      const internalRowId = op.rowNodeId
        ? previousIdentity.internalNodeIdByPublicId.get(op.rowNodeId)
        : undefined
      const rowNode = internalRowId
        ? previousIndex.editableNodesById.get(internalRowId)?.node
        : undefined
      const anchorIndex = rowNode ? childElements(table, 'tr').indexOf(rowNode) : rows.length - 1
      const insertIndex = Math.max(0, anchorIndex + (op.position === 'before' ? 0 : 1))
      rows.splice(
        insertIndex,
        0,
        op.cells.map(() => createNodeId())
      )
    } else if (op.type === 'delete_row') {
      const internalRowId = previousIdentity.internalNodeIdByPublicId.get(op.rowNodeId)
      const rowNode = internalRowId
        ? previousIndex.editableNodesById.get(internalRowId)?.node
        : undefined
      const rowIndex = rowNode ? childElements(table, 'tr').indexOf(rowNode) : -1
      if (rowIndex < 0) throw new Error('cannot update DOCX identity for deleted row')
      rows.splice(rowIndex, 1)
    } else if (op.type === 'insert_column') {
      rows.forEach((row) => row.splice(op.columnIndex, 0, createNodeId()))
    } else if (op.type === 'delete_column') {
      rows.forEach((row) => row.splice(op.columnIndex, 1))
    } else if (op.type === 'merge_cells') {
      const fromRow = Math.min(op.fromRow, op.toRow)
      const toRow = Math.max(op.fromRow, op.toRow)
      const fromColumn = Math.min(op.fromColumn, op.toColumn)
      const removeCount = Math.abs(op.toColumn - op.fromColumn)
      for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
        rows[rowIndex]?.splice(fromColumn + 1, removeCount)
      }
    } else {
      const internalCellId = previousIdentity.internalNodeIdByPublicId.get(op.cellNodeId)
      const cellNode = internalCellId
        ? previousIndex.editableNodesById.get(internalCellId)?.node
        : undefined
      const rowNode = cellNode?.parentNode as Element | undefined
      const rowIndex = rowNode ? childElements(table, 'tr').indexOf(rowNode) : -1
      const columnIndex = rowNode && cellNode ? childElements(rowNode, 'tc').indexOf(cellNode) : -1
      if (rowIndex < 0 || columnIndex < 0)
        throw new Error('cannot update DOCX identity for split cell')
      rows[rowIndex]!.splice(
        columnIndex + 1,
        0,
        ...Array.from({ length: op.columns - 1 }, createNodeId)
      )
      const newRowWidth = rows[rowIndex]!.length
      rows.splice(
        rowIndex + 1,
        0,
        ...Array.from({ length: op.rows - 1 }, () =>
          Array.from({ length: newRowWidth }, createNodeId)
        )
      )
    }
    context.logical.cellNodeIds = rows.flat()
    return
  }

  if (op.type === 'move_node') {
    const sourceIndex = body.findIndex((node) => node.nodeId === op.nodeId)
    const anchorIndex = body.findIndex((node) => node.nodeId === op.anchorNodeId)
    if (sourceIndex < 0 || anchorIndex < 0) return
    const [moving] = body.splice(sourceIndex, 1)
    if (!moving) return
    const nextAnchorIndex = body.findIndex((node) => node.nodeId === op.anchorNodeId)
    body.splice(nextAnchorIndex + (op.position === 'after' ? 1 : 0), 0, moving)
    return
  }

  return
}

export const createNextIdentityIndex = (input: {
  previousIndex: NodeIndex
  previousIdentity: DocxIdentityIndex
  nextIndex: NodeIndex
  publicOps: DocxOperation[]
}): DocxIdentityIndex => {
  const logicalBody = currentLogicalBody(input.previousIndex, input.previousIdentity)
  for (const op of input.publicOps) {
    applyLogicalOp(logicalBody, op, input.previousIndex, input.previousIdentity)
  }
  if (logicalBody.length !== input.nextIndex.bodyNodeIds.length) {
    throw new Error(
      `docx identity body mismatch: expected ${String(logicalBody.length)}, got ${String(input.nextIndex.bodyNodeIds.length)}`
    )
  }

  const identity: DocxIdentityIndex = {
    publicIdByInternalId: new Map(),
    internalIdByPublicId: new Map(),
    publicNodeIdByInternalId: new Map(),
    internalNodeIdByPublicId: new Map(),
    publicVisualIdByInternalId: new Map(),
    internalVisualIdByPublicId: new Map()
  }

  input.nextIndex.bodyNodeIds.forEach((internalId, index) => {
    const logical = logicalBody[index]
    if (!logical) throw new Error(`docx logical identity missing at index ${String(index)}`)
    bindIdentity(identity, internalId, logical.nodeId)
    const node = input.nextIndex.nodesById.get(internalId)
    if (node?.kind !== 'table') return
    const cells = [...input.nextIndex.nodesById.values()]
      .filter(isTableCellNode)
      .filter((candidate) => candidate.tableNodeId === internalId)
      .sort((left, right) => left.row - right.row || left.col - right.col)
    if (cells.length !== logical.cellNodeIds.length) {
      throw new Error(
        `docx table identity mismatch for ${logical.nodeId}: expected ${String(logical.cellNodeIds.length)}, got ${String(cells.length)}`
      )
    }
    cells.forEach((cell, cellIndex) =>
      bindIdentity(identity, cell.nodeId, logical.cellNodeIds[cellIndex])
    )
  })

  bindNestedIdentities(input.nextIndex, identity, input.previousIndex, input.previousIdentity)

  return identity
}

export const toPublicChangedNodes = (input: {
  changedNodes: DocxChangedNode[]
  previousIdentity: DocxIdentityIndex
  nextIdentity: DocxIdentityIndex
}): DocxChangedNode[] =>
  input.changedNodes.map((change) => ({
    ...change,
    nodeId:
      resolvePublicNodeId(input.nextIdentity, change.nodeId) ||
      resolvePublicNodeId(input.previousIdentity, change.nodeId) ||
      change.nodeId
  }))
