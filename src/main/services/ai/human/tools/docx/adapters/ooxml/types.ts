import type JSZip from 'jszip'
import type {
  DocxChangedNode,
  DocxDetailedNode,
  DocxLayoutMode,
  DocxStoryRef,
  DocxOutlineNode,
  DocxVisualKind
} from '../../types'

export type IndexedNode =
  | {
      kind: 'paragraph'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      kind: 'table'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      kind: 'content_control' | 'revision'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      kind: 'table_cell'
      nodeId: string
      tableNodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      row: number
      col: number
      node: Element
      firstParagraph: Element | null
    }

export type NodeMapById = Map<string, IndexedNode>

export type NodeIndex = {
  outline: DocxOutlineNode[]
  nodesById: NodeMapById
  rootNodeIds: string[]
  paragraphCount: number
  tableCount: number
  charCount: number
  rootNodeCount: number
  cellNodeCount: number
  detailByNodeId: Map<string, DocxDetailedNode>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}

export type DocxEditableNode = {
  nodeId: string
  ownerNodeId: string
  story: DocxStoryRef
  partName: string
  kind:
    | 'paragraph'
    | 'run'
    | 'table'
    | 'table_row'
    | 'table_cell'
    | 'hyperlink'
    | 'field'
    | 'content_control'
    | 'revision'
  node: Element
}

export type DocxVisualDescriptor = {
  visualId: string
  ownerNodeId: string
  kind: DocxVisualKind
  relationshipId?: string
  target?: string
  contentType?: string
  story: DocxStoryRef
  partName: string
}

export type DocxStoryPart = {
  story: DocxStoryRef
  partName: string
  dom: Document
  root: Element
  relationshipTargets: Map<string, string>
  relationshipTypes: Map<string, string>
  relationshipTargetModes: Map<string, string>
  availableRelationshipTargetIds: Set<string>
}

export type ParsedDocxBundle = {
  zip: JSZip
  documentXml: string
  documentDom: Document
  stylesDom?: Document
  relationshipTargets: Map<string, string>
  relationshipTypes: Map<string, string>
  relationshipTargetModes: Map<string, string>
  availableRelationshipTargetIds: Set<string>
  stories: DocxStoryPart[]
}

export type ApplyOpsResult = {
  buffer: Buffer
  changedNodes: DocxChangedNode[]
}
