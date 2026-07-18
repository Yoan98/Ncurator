import { randomUUID } from 'node:crypto'
import type {
  DocxBlockSpec,
  DocxChangedBlock,
  DocxDetailedBlock,
  DocxDetailedParagraphBlock,
  DocxOp,
  DocxOutlineBlock,
  DocxSearchMatch
} from '../types'
import type { BlockIndex, IndexedNode } from '../adapters/ooxml/types'

export type DocxIdentityIndex = {
  publicIdByInternalId: Map<string, string>
  internalIdByPublicId: Map<string, string>
  nestedParagraphIdByKey: Map<string, string>
}

type LogicalBodyBlock = {
  blockId: string
  kind: 'paragraph' | 'table'
  cellBlockIds: string[]
}

const isTableCellNode = (node: IndexedNode): node is Extract<IndexedNode, { kind: 'table_cell' }> =>
  node.kind === 'table_cell'

const createBlockId = (): string => `blk_${randomUUID().replace(/-/g, '')}`

const bindIdentity = (
  identity: DocxIdentityIndex,
  internalId: string,
  publicId = createBlockId()
): string => {
  identity.publicIdByInternalId.set(internalId, publicId)
  identity.internalIdByPublicId.set(publicId, internalId)
  return publicId
}

export const createInitialIdentityIndex = (index: BlockIndex): DocxIdentityIndex => {
  const identity: DocxIdentityIndex = {
    publicIdByInternalId: new Map(),
    internalIdByPublicId: new Map(),
    nestedParagraphIdByKey: new Map()
  }
  for (const internalId of index.nodesById.keys()) bindIdentity(identity, internalId)
  return identity
}

export const resolveInternalBlockId = (identity: DocxIdentityIndex, publicId: string): string => {
  const internalId = identity.internalIdByPublicId.get(publicId)
  if (!internalId)
    throw new Error(`stale or unknown docx blockId: ${publicId}; read the document again`)
  return internalId
}

const resolvePublicBlockId = (
  identity: DocxIdentityIndex,
  internalId: string | undefined
): string | undefined => {
  if (!internalId) return undefined
  return identity.publicIdByInternalId.get(internalId)
}

const requirePublicBlockId = (identity: DocxIdentityIndex, internalId: string): string => {
  const publicId = resolvePublicBlockId(identity, internalId)
  if (!publicId) throw new Error(`docx identity missing for internal block: ${internalId}`)
  return publicId
}

const mapNeighborFields = <T extends { previousBlockId?: string; nextBlockId?: string }>(
  identity: DocxIdentityIndex,
  value: T
): T => ({
  ...value,
  previousBlockId: resolvePublicBlockId(identity, value.previousBlockId),
  nextBlockId: resolvePublicBlockId(identity, value.nextBlockId)
})

export const toPublicOutlineBlock = (
  identity: DocxIdentityIndex,
  block: DocxOutlineBlock
): DocxOutlineBlock => {
  const mapped = mapNeighborFields(identity, block)
  if (mapped.type === 'table_cell') {
    return {
      ...mapped,
      blockId: requirePublicBlockId(identity, mapped.blockId),
      tableBlockId: requirePublicBlockId(identity, mapped.tableBlockId)
    }
  }
  return {
    ...mapped,
    blockId: requirePublicBlockId(identity, mapped.blockId)
  }
}

const nestedParagraphId = (
  identity: DocxIdentityIndex,
  cellBlockId: string,
  paragraphIndex: number
): string => {
  const key = `${cellBlockId}:paragraph:${String(paragraphIndex)}`
  const existing = identity.nestedParagraphIdByKey.get(key)
  if (existing) return existing
  const created = createBlockId()
  identity.nestedParagraphIdByKey.set(key, created)
  return created
}

const toPublicNestedParagraph = (
  identity: DocxIdentityIndex,
  cellBlockId: string,
  paragraph: DocxDetailedParagraphBlock,
  paragraphIndex: number
): DocxDetailedParagraphBlock => ({
  ...mapNeighborFields(identity, paragraph),
  blockId: nestedParagraphId(identity, cellBlockId, paragraphIndex)
})

export const toPublicDetailedBlock = (
  identity: DocxIdentityIndex,
  block: DocxDetailedBlock
): DocxDetailedBlock => {
  const mapped = mapNeighborFields(identity, block)
  if (mapped.type === 'paragraph') {
    return { ...mapped, blockId: requirePublicBlockId(identity, mapped.blockId) }
  }
  if (mapped.type === 'table_cell') {
    const publicCellId = requirePublicBlockId(identity, mapped.blockId)
    return {
      ...mapped,
      blockId: publicCellId,
      tableBlockId: requirePublicBlockId(identity, mapped.tableBlockId),
      paragraphs: mapped.paragraphs.map((paragraph, index) =>
        toPublicNestedParagraph(identity, publicCellId, paragraph, index)
      )
    }
  }
  return {
    ...mapped,
    blockId: requirePublicBlockId(identity, mapped.blockId),
    cells: mapped.cells.map((cell) => {
      const publicCellId = requirePublicBlockId(identity, cell.blockId)
      return {
        ...cell,
        blockId: publicCellId,
        paragraphs: cell.paragraphs.map((paragraph, index) =>
          toPublicNestedParagraph(identity, publicCellId, paragraph, index)
        )
      }
    })
  }
}

export const toPublicSearchMatch = (
  identity: DocxIdentityIndex,
  match: DocxSearchMatch
): DocxSearchMatch => ({
  ...mapNeighborFields(identity, match),
  blockId: requirePublicBlockId(identity, match.blockId),
  tableBlockId: resolvePublicBlockId(identity, match.tableBlockId)
})

const translateIds = (
  identity: DocxIdentityIndex,
  ids: string[] | undefined
): string[] | undefined => ids?.map((blockId) => resolveInternalBlockId(identity, blockId))

export const toInternalOp = (identity: DocxIdentityIndex, op: DocxOp): DocxOp => {
  if (op.type === 'insert_before' || op.type === 'insert_after') {
    return { ...op, anchorBlockId: resolveInternalBlockId(identity, op.anchorBlockId) }
  }
  if (op.type === 'replace_text') {
    return { ...op, blockIds: translateIds(identity, op.blockIds) }
  }
  if (op.type === 'create_document') return op
  return { ...op, blockId: resolveInternalBlockId(identity, op.blockId) }
}

const tableCellCount = (spec: Extract<DocxBlockSpec, { kind: 'table' }>): number =>
  spec.rows.reduce((total, row) => total + row.length, 0)

const logicalBlockFromSpec = (
  spec: DocxBlockSpec,
  blockId = createBlockId()
): LogicalBodyBlock => ({
  blockId,
  kind: spec.kind,
  cellBlockIds:
    spec.kind === 'table' ? Array.from({ length: tableCellCount(spec) }, () => createBlockId()) : []
})

const currentLogicalBody = (index: BlockIndex, identity: DocxIdentityIndex): LogicalBodyBlock[] =>
  index.bodyBlockIds.map((internalId) => {
    const node = index.nodesById.get(internalId)
    if (!node || node.kind === 'table_cell') {
      throw new Error(`invalid docx body identity node: ${internalId}`)
    }
    const cellBlockIds =
      node.kind === 'table'
        ? [...index.nodesById.values()]
            .filter(isTableCellNode)
            .filter((candidate) => candidate.tableBlockId === internalId)
            .sort((left, right) => left.row - right.row || left.col - right.col)
            .map((cell) => requirePublicBlockId(identity, cell.blockId))
        : []
    return {
      blockId: requirePublicBlockId(identity, internalId),
      kind: node.kind,
      cellBlockIds
    }
  })

const applyLogicalOp = (body: LogicalBodyBlock[], op: DocxOp): void => {
  if (op.type === 'create_document' || op.type === 'replace_text' || op.type === 'style_text')
    return
  if (op.type === 'update_table_cell') return

  if (op.type === 'insert_before' || op.type === 'insert_after') {
    const anchorIndex = body.findIndex((block) => block.blockId === op.anchorBlockId)
    if (anchorIndex < 0)
      throw new Error(`cannot update docx identity for anchor: ${op.anchorBlockId}`)
    const inserted = op.content.map((spec) => logicalBlockFromSpec(spec))
    body.splice(anchorIndex + (op.type === 'insert_after' ? 1 : 0), 0, ...inserted)
    return
  }

  const targetIndex = body.findIndex((block) => block.blockId === op.blockId)
  if (targetIndex < 0) throw new Error(`cannot update docx identity for target: ${op.blockId}`)
  if (op.type === 'delete_block') {
    body.splice(targetIndex, 1)
    return
  }
  if (op.type === 'replace_block') {
    body[targetIndex] = logicalBlockFromSpec(op.content, op.blockId)
  }
}

export const createNextIdentityIndex = (input: {
  previousIndex: BlockIndex
  previousIdentity: DocxIdentityIndex
  nextIndex: BlockIndex
  publicOps: DocxOp[]
}): DocxIdentityIndex => {
  const logicalBody = currentLogicalBody(input.previousIndex, input.previousIdentity)
  for (const op of input.publicOps) applyLogicalOp(logicalBody, op)
  if (logicalBody.length !== input.nextIndex.bodyBlockIds.length) {
    throw new Error(
      `docx identity body mismatch: expected ${String(logicalBody.length)}, got ${String(input.nextIndex.bodyBlockIds.length)}`
    )
  }

  const identity: DocxIdentityIndex = {
    publicIdByInternalId: new Map(),
    internalIdByPublicId: new Map(),
    nestedParagraphIdByKey: new Map(input.previousIdentity.nestedParagraphIdByKey)
  }

  input.nextIndex.bodyBlockIds.forEach((internalId, index) => {
    const logical = logicalBody[index]
    if (!logical) throw new Error(`docx logical identity missing at index ${String(index)}`)
    bindIdentity(identity, internalId, logical.blockId)
    const node = input.nextIndex.nodesById.get(internalId)
    if (node?.kind !== 'table') return
    const cells = [...input.nextIndex.nodesById.values()]
      .filter(isTableCellNode)
      .filter((candidate) => candidate.tableBlockId === internalId)
      .sort((left, right) => left.row - right.row || left.col - right.col)
    if (cells.length !== logical.cellBlockIds.length) {
      throw new Error(
        `docx table identity mismatch for ${logical.blockId}: expected ${String(logical.cellBlockIds.length)}, got ${String(cells.length)}`
      )
    }
    cells.forEach((cell, cellIndex) =>
      bindIdentity(identity, cell.blockId, logical.cellBlockIds[cellIndex])
    )
  })

  return identity
}

export const toPublicChangedBlocks = (input: {
  changedBlocks: DocxChangedBlock[]
  previousIdentity: DocxIdentityIndex
  nextIdentity: DocxIdentityIndex
}): DocxChangedBlock[] =>
  input.changedBlocks.map((change) => ({
    ...change,
    blockId:
      resolvePublicBlockId(input.nextIdentity, change.blockId) ||
      resolvePublicBlockId(input.previousIdentity, change.blockId) ||
      change.blockId
  }))
