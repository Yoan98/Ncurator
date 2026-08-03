import type JSZip from 'jszip'
import type {
  DocxChangedBlock,
  DocxBlockWrapper,
  DocxDetailedBlock,
  DocxLayoutMode,
  DocxOpenMeta,
  DocxOutlineBlock,
  DocxVisualKind
} from '../../types'

export type IndexedNode =
  | {
      kind: 'paragraph'
      blockId: string
      blockIndex: number
      layoutMode: DocxLayoutMode
      wrapperPath: DocxBlockWrapper[]
      node: Element
    }
  | {
      kind: 'table'
      blockId: string
      blockIndex: number
      layoutMode: DocxLayoutMode
      wrapperPath: DocxBlockWrapper[]
      node: Element
    }
  | {
      kind: 'table_cell'
      blockId: string
      tableBlockId: string
      blockIndex: number
      layoutMode: DocxLayoutMode
      wrapperPath: DocxBlockWrapper[]
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
  detailByBlockId: Map<string, DocxDetailedBlock>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}

export type DocxEditableNode = {
  nodeId: string
  blockId: string
  kind: 'paragraph' | 'run' | 'table' | 'table_row' | 'table_cell'
  node: Element
}

export type DocxVisualDescriptor = {
  visualId: string
  blockId: string
  kind: DocxVisualKind
  relationshipId?: string
  target?: string
  contentType?: string
}

export type ParsedDocxBundle = {
  zip: JSZip
  documentXml: string
  documentDom: Document
  meta: DocxOpenMeta
  relationshipTargets: Map<string, string>
  relationshipTypes: Map<string, string>
  relationshipTargetModes: Map<string, string>
  availableRelationshipTargetIds: Set<string>
}

export type ApplyOpsResult = {
  buffer: Buffer
  changedBlocks: DocxChangedBlock[]
}
