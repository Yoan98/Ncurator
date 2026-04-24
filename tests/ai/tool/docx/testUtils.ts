import type { DocxChangedBlock, DocxOutlineBlock } from '../../../../src/main/services/ai/human/tools/docx/types'

export type DocxOutlineResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentRevisionRef: string
  returnedBlockCount: number
  totalBlockCount: number
  fromBodyIndex?: number
  blocks: Array<
    | {
        blockId: string
        type: 'paragraph'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        style?: string
        headingLevel?: number
        preview: string
      }
    | {
        blockId: string
        type: 'table'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        rows?: number
        cols?: number
        preview: string
      }
    | {
        blockId: string
        type: 'table_cell'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        tableBlockId?: string
        row?: number
        col?: number
        preview: string
      }
  >
  truncated: boolean
}

export type DocxSearchResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentRevisionRef: string
  mode: 'literal' | 'regex' | 'semantic'
  effectiveQuery: string
  appliedAliases: Array<{ from: string; to: string }>
  totalMatchCount: number
  returnedMatchCount: number
  truncated: boolean
  matches: Array<{
    blockId: string
    blockType: 'paragraph' | 'table' | 'table_cell'
    bodyIndex: number
    previousBodyBlockId?: string
    nextBodyBlockId?: string
    tableBlockId?: string
    text: string
    offsets?: Array<{ start: number; end: number }>
    score?: number
  }>
}

export type DocxReadResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentRevisionRef: string
  fromBlockId: string
  toBlockId: string
  returnedBlockCount: number
  blocks: Array<
    | {
        blockId: string
        type: 'paragraph'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        text: string
        style?: string
        headingLevel?: number
        runs: Array<{
          text: string
          bold?: boolean
          italic?: boolean
          underline?: boolean
          color?: string
        }>
      }
    | {
        blockId: string
        type: 'table'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        rows: number
        cols: number
        preview: string
        cells: Array<{
          blockId: string
          row: number
          col: number
          paragraphs: Array<{
            blockId: string
            type: 'paragraph'
            bodyIndex: number
            previousBodyBlockId?: string
            nextBodyBlockId?: string
            style: string
            text: string
            runs: Array<{
              text: string
              bold?: boolean
              italic?: boolean
              underline?: boolean
              color?: string
            }>
          }>
        }>
      }
    | {
        blockId: string
        type: 'table_cell'
        bodyIndex: number
        previousBodyBlockId?: string
        nextBodyBlockId?: string
        tableBlockId: string
        row: number
        col: number
        text: string
        paragraphs: Array<{
          blockId: string
          type: 'paragraph'
          bodyIndex: number
          previousBodyBlockId?: string
          nextBodyBlockId?: string
          style: string
          text: string
          runs: Array<{
            text: string
            bold?: boolean
            italic?: boolean
            underline?: boolean
            color?: string
          }>
        }>
      }
  >
}

export type DocxCreateResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentRevisionRef: string
  created: true
}

export type DocxMutationResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  previousRevisionRef: string
  currentRevisionRef: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: Array<{ blockId: string; type: 'paragraph' | 'table' | 'table_cell' }>
  warnings: string[]
}

export type DocxHistoryResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  summary: string
  sourcePath: string
  currentRevisionRef: string
  revisions: Array<{
    revisionRef: string
    parentRevisionRef?: string
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
  currentRevisionRef: string
  previousRevisionRef: string
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
