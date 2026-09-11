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
      category: 'root'
      kind: 'paragraph'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      category: 'root'
      kind: 'table'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      category: 'root'
      kind: 'content_control' | 'revision'
      nodeId: string
      nodeIndex: number
      layoutMode: DocxLayoutMode
      story: DocxStoryRef
      partName: string
      node: Element
    }
  | {
      category: 'root'
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

export type NodeMapById = Map<string, IndexedNode | DocxEditableNode | DocxVisualDescriptor>

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
}

export type DocxEditableNode = {
  category: 'editable'
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
  category: 'visual'
  nodeId: string
  ownerNodeId: string
  kind: DocxVisualKind
  node: Element
  relationshipId?: string
  target?: string
  contentType?: string
  widthCm?: number
  heightCm?: number
  story: DocxStoryRef
  partName: string
}

export const isRootNode = (
  node: IndexedNode | DocxEditableNode | DocxVisualDescriptor
): node is IndexedNode => node.category === 'root'

export const isEditableNode = (
  node: IndexedNode | DocxEditableNode | DocxVisualDescriptor
): node is DocxEditableNode => node.category === 'editable'

export const isVisualNode = (
  node: IndexedNode | DocxEditableNode | DocxVisualDescriptor
): node is DocxVisualDescriptor => node.category === 'visual'

export const collectVisualNodeEntries = (index: NodeIndex): Array<[string, DocxVisualDescriptor]> =>
  [...index.nodesById.entries()].filter((entry): entry is [string, DocxVisualDescriptor] =>
    isVisualNode(entry[1])
  )

export const collectEditableNodeEntries = (index: NodeIndex): Array<[string, DocxEditableNode]> =>
  [...index.nodesById.entries()].filter((entry): entry is [string, DocxEditableNode] =>
    isEditableNode(entry[1])
  )

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
