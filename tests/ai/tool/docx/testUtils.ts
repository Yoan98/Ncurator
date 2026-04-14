import type {
  DocxChangedBlock,
  DocxDetailedBlock,
  DocxOutlineBlock
} from '../../../../src/main/services/ai/human/tools/docx/types'

export type DocxOpenResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  docId: string
  meta: {
    title: string
    creator: string
    lastModifiedBy: string
    description: string
    defaultFont: string
  }
  stats: {
    blockCount: number
    paragraphCount: number
    tableCount: number
    imageCount: number
    charCount: number
  }
}

export type DocxOutlineResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  blocks: DocxOutlineBlock[]
  truncated: boolean
}

export type DocxSearchResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  matches: Array<{
    blockId: string
    blockType: 'paragraph' | 'table' | 'table_cell'
    bodyIndex: number
    previousBodyBlockId?: string
    nextBodyBlockId?: string
    tableBlockId?: string
    text: string
    offsets: Array<{ start: number; end: number }>
  }>
  warnings: string[]
}

export type DocxGetBlockResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  block: DocxDetailedBlock
}

export type DocxApplyOpsResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  newDocId: string
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}

export type DocxHistoryResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  currentDocId: string
  snapshots: Array<{
    docId: string
    parentDocId?: string
    createdAt: number
  }>
}

export type DocxRollbackResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  docId: string
  previousDocId: string
  stepsApplied: number
}

export type DocxFailureResult = {
  ok: false
  code: 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  error: string
  warnings: string[]
}

export const findOutlineBlock = (
  blocks: readonly DocxOutlineBlock[],
  predicate: (block: DocxOutlineBlock) => boolean
): DocxOutlineBlock => {
  const matched = blocks.find(predicate)
  if (!matched) {
    throw new Error('expected outline block was not found')
  }
  return matched
}

export const findParagraphBlockIdByText = (
  blocks: readonly DocxOutlineBlock[],
  textFragment: string
): string =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'paragraph' && block.text.includes(textFragment)
  ).blockId

export const findTableBlockId = (blocks: readonly DocxOutlineBlock[]): string =>
  findOutlineBlock(blocks, (block) => block.type === 'table').blockId

export const findTableCellBlockIdByText = (
  blocks: readonly DocxOutlineBlock[],
  textFragment: string
): string =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'table_cell' && block.text.includes(textFragment)
  ).blockId
