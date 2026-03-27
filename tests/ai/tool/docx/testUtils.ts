import type {
  DocxChangedBlock,
  DocxDetailedBlock,
  DocxOutlineBlock,
  DocxValidationProblem
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

export type DocxValidateResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  problems: DocxValidationProblem[]
}

export type DocxPreviewResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  format: 'html'
  previewPath: string
  renderer: 'docx_file_artifact'
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

export type DocxSaveResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  outPath: string
  checksum: string
  operation: 'created' | 'updated'
  byteSize: number
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
