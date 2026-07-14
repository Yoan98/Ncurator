import type {
  DocxChangedBlock,
  DocxOutlineBlock
} from '../../../../../src/main/services/ai/human/tools/docx/types'

export type DocxOutlineResult = {
  sourcePath: string
  currentRevisionRef: string
  blocks: Array<
    | {
        blockId: string
        type: 'paragraph'
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
        style?: string
        headingLevel?: number
        text: string
      }
    | {
        blockId: string
        type: 'table'
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
        rows?: number
        cols?: number
        text: string
      }
    | {
        blockId: string
        type: 'table_cell'
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
        tableBlockId?: string
        row?: number
        col?: number
        text: string
      }
  >
}

export type DocxSearchResult = {
  sourcePath: string
  currentRevisionRef: string
  mode: 'literal' | 'regex' | 'semantic'
  effectiveQuery: string
  appliedAliases: Array<{ from: string; to: string }>
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{
    blockId: string
    type: 'paragraph' | 'table' | 'table_cell'
    blockIndex: number
    previousBlockId?: string
    nextBlockId?: string
    tableBlockId?: string
    matchedText: string
    text: string
    offsets?: Array<{ start: number; end: number }>
    score?: number
  }>
}

export type DocxReadResult = {
  sourcePath: string
  currentRevisionRef: string
  fromBlockIndex?: number
  toBlockIndex?: number
  blocks: Array<
    | {
        blockId: string
        type: 'paragraph'
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
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
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
        rows: number
        cols: number
        text: string
        cells: Array<{
          blockId: string
          row: number
          col: number
          paragraphs: Array<{
            blockId: string
            type: 'paragraph'
            blockIndex: number
            previousBlockId?: string
            nextBlockId?: string
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
        blockIndex: number
        previousBlockId?: string
        nextBlockId?: string
        tableBlockId: string
        row: number
        col: number
        text: string
        paragraphs: Array<{
          blockId: string
          type: 'paragraph'
          blockIndex: number
          previousBlockId?: string
          nextBlockId?: string
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
  sourcePath: string
  previousRevisionRef: string
  currentRevisionRef: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks: Array<{ blockId: string; type: 'paragraph' | 'table' | 'table_cell' }>
  warnings: string[]
  postWriteReadback: {
    regions: Array<{
      fromBlockId: string
      fromBlockIndex: number
      toBlockId: string
      toBlockIndex: number
      blocks: DocxReadResult['blocks']
    }>
  }
}

export type DocxMutationResult = {
  sourcePath: string
  previousRevisionRef: string
  currentRevisionRef: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: Array<{ blockId: string; type: 'paragraph' | 'table' | 'table_cell' }>
  warnings: string[]
  postWriteReadback?: {
    regions: Array<{
      fromBlockId: string
      fromBlockIndex: number
      toBlockId: string
      toBlockIndex: number
      blocks: DocxReadResult['blocks']
    }>
  }
}

export type DocxFailureResult = {
  error: string
  warnings: string[]
  reason?: string
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
    (block) => block.type === 'paragraph' && block.text.includes(textFragment)
  ).blockId

export const findParagraphBlockIndexByText = (
  blocks: readonly DocxOutlineResult['blocks'],
  textFragment: string
): number =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'paragraph' && block.text.includes(textFragment)
  ).blockIndex

export const findTableCellBlockIdByText = (
  blocks: readonly DocxOutlineResult['blocks'],
  textFragment: string
): string =>
  findOutlineBlock(
    blocks,
    (block) => block.type === 'table_cell' && block.text.includes(textFragment)
  ).blockId
