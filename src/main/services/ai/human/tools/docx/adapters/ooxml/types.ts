import type JSZip from 'jszip'
import type {
  DocxChangedBlock,
  DocxLayoutMode,
  DocxOpenMeta,
  DocxOutlineBlock
} from '../../types'

export type IndexedNode =
  | {
      kind: 'paragraph'
      blockId: string
      bodyIndex: number
      layoutMode: DocxLayoutMode
      node: Element
    }
  | {
      kind: 'table'
      blockId: string
      bodyIndex: number
      layoutMode: DocxLayoutMode
      node: Element
    }
  | {
      kind: 'table_cell'
      blockId: string
      tableBlockId: string
      bodyIndex: number
      layoutMode: DocxLayoutMode
      row: number
      col: number
      node: Element
      firstParagraph: Element | null
    }

export type NodeMapById = Map<string, IndexedNode>

export type BlockIndex = {
  outline: DocxOutlineBlock[]
  nodesById: NodeMapById
  bodyBlockIds: string[]
  paragraphCount: number
  tableCount: number
  charCount: number
  bodyBlockCount: number
  cellBlockCount: number
}

export type ParsedDocxBundle = {
  zip: JSZip
  documentXml: string
  documentDom: Document
  meta: DocxOpenMeta
  imageCount: number
}

export type ApplyOpsResult = {
  buffer: Buffer
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}
