import type { DocxChangedBlock, DocxOutlineBlock } from '../../../../src/main/services/ai/human/tools/docx/types'

export type DocxOutlineResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentVersionRef: string
  returnedBlockCount: number
  totalBlockCount: number
  blocks: Array<
    | {
        blockId: string
        type: 'paragraph'
        bodyIndex: number
        style?: string
        headingLevel?: number
        preview: string
      }
    | {
        blockId: string
        type: 'table'
        bodyIndex: number
        rows?: number
        cols?: number
        preview: string
      }
    | {
        blockId: string
        type: 'table_cell'
        bodyIndex: number
        tableBlockId?: string
        row?: number
        col?: number
        preview: string
      }
  >
  truncated: boolean
}

export type DocxReadResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentVersionRef: string
  truncated: boolean
  totalMatchCount?: number
  matches: Array<
    | {
        blockId: string
        type: 'paragraph'
        bodyIndex: number
        text: string
        style?: string
        headingLevel?: number
        contextBefore?: string
        contextAfter?: string
      }
    | {
        blockId: string
        type: 'table'
        bodyIndex: number
        rows: Array<Array<{ cellBlockId: string; text: string }>>
        contextBefore?: string
        contextAfter?: string
      }
    | {
        blockId: string
        type: 'table_cell'
        bodyIndex: number
        tableBlockId: string
        row: number
        col: number
        text: string
        contextBefore?: string
        contextAfter?: string
      }
  >
}

export type DocxMutationResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  previousVersionRef: string
  currentVersionRef: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: Array<{ blockId: string; type: 'paragraph' | 'table' | 'table_cell' }>
  warnings: string[]
}

export type DocxHistoryResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentVersionRef: string
  versions: Array<{
    versionRef: string
    parentVersionRef?: string
    createdAt: number
    isCurrent: boolean
    summary: string
    changedBlocks: DocxChangedBlock[]
  }>
}

export type DocxRollbackResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentVersionRef: string
  previousVersionRef: string
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
  blocks: readonly DocxOutlineResult['blocks'],
  textFragment: string
): string =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'paragraph' && block.preview.includes(textFragment)
  ).blockId

export const findTableBlockId = (blocks: readonly DocxOutlineResult['blocks']): string =>
  findOutlineBlock(blocks, (block) => block.type === 'table').blockId

export const findTableCellBlockIdByText = (
  blocks: readonly DocxOutlineResult['blocks'],
  textFragment: string
): string =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'table_cell' && block.preview.includes(textFragment)
  ).blockId
