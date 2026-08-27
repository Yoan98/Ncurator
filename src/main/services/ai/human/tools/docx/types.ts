import type { DocxToolContext } from '../../../types'
import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import {
  nodeSpecSchema,
  docxCreateRootNodeSchema,
  docxCommentsRevisionsSchema,
  docxContentEditSchema,
  docxContentNodeDraftSchema,
  docxFormatSchema,
  docxMediaEditSchema,
  docxOutlineSchema,
  docxReadNodesSchema,
  docxSearchSchema,
  docxTableEditSchema,
  docxReadVisualsSchema,
  docxSearchModeSchema,
  paragraphSpecSchema,
  runSpecSchema,
  tableCellSpecSchema,
  tableSpecSchema
} from './schemas'
import type {
  DocxParagraphStyle,
  DocxReadContentNode,
  DocxReadParagraphNode,
  DocxReadTableCellNode,
  DocxReadTableNode,
  DocxStoryRef,
  DocxVisualKind
} from './nodeTypes'

export type * from './nodeTypes'

export type DocxTextRunSpec = z.infer<typeof runSpecSchema>
export type DocxParagraphSpec = z.infer<typeof paragraphSpecSchema>
export type DocxTableCellSpec = z.infer<typeof tableCellSpecSchema>
export type DocxTableSpec = z.infer<typeof tableSpecSchema>
export type DocxNodeSpec = z.infer<typeof nodeSpecSchema>
type WithoutSourcePath<TValue> = TValue extends { sourcePath: string }
  ? Omit<TValue, 'sourcePath'>
  : never

type DocxFormatTextRequest = Extract<DocxFormatRequest, { type: 'format_text' }>
type DocxBatchNodeFormatRequest = Extract<DocxFormatRequest, { nodeIds: string[] }>
type DocxNamedStyleFormatRequest = Exclude<
  DocxFormatRequest,
  DocxFormatTextRequest | DocxBatchNodeFormatRequest
>
type ExpandNodeFormatRequest<TValue> = TValue extends {
  sourcePath: string
  nodeIds: string[]
}
  ? Omit<TValue, 'sourcePath' | 'nodeIds'> & { nodeId: string }
  : never

type DocxTableFormatRequest = Extract<
  DocxTableEditRequest,
  { type: 'format_table' | 'format_row' | 'format_cell' }
>
type DocxTableStructureRequest = Exclude<DocxTableEditRequest, DocxTableFormatRequest>

export type DocxFormatOperation =
  | (Omit<DocxFormatTextRequest, 'sourcePath' | 'targets'> & {
      nodeId: string
      text?: string
    })
  | ExpandNodeFormatRequest<DocxBatchNodeFormatRequest>
  | WithoutSourcePath<DocxNamedStyleFormatRequest>

export type DocxOperation =
  | { type: 'create_document' }
  | WithoutSourcePath<DocxContentEditRequest>
  | DocxFormatOperation
  | ExpandNodeFormatRequest<DocxTableFormatRequest>
  | WithoutSourcePath<DocxTableStructureRequest>
  | WithoutSourcePath<DocxMediaEditRequest>
  | WithoutSourcePath<DocxCommentsRevisionsRequest>

export type DocxLayoutMode = 'normal' | 'positioned'

export type DocxOutlineParagraphNode = {
  nodeId: string
  type: 'paragraph'
  nodeIndex: number
  layoutMode: DocxLayoutMode
  previousNodeId?: string
  nextNodeId?: string
  style?: DocxParagraphStyle
  text: string
  visuals?: DocxVisualSummary
  story: DocxStoryRef
}

export type DocxOutlineTableNode = {
  nodeId: string
  type: 'table'
  nodeIndex: number
  layoutMode: DocxLayoutMode
  previousNodeId?: string
  nextNodeId?: string
  rows: number
  cols: number
  text: string
  visuals?: DocxVisualSummary
  story: DocxStoryRef
}

export type DocxOutlineCellNode = {
  nodeId: string
  type: 'table_cell'
  nodeIndex: number
  layoutMode: DocxLayoutMode
  previousNodeId?: string
  nextNodeId?: string
  tableNodeId: string
  row: number
  col: number
  text: string
  visuals?: DocxVisualSummary
  story: DocxStoryRef
}

type DocxOutlineContainerMeta = {
  nodeId: string
  nodeIndex: number
  layoutMode: DocxLayoutMode
  previousNodeId?: string
  nextNodeId?: string
  text: string
  story: DocxStoryRef
  visuals?: DocxVisualSummary
}

export type DocxOutlineContainerNode =
  | (DocxOutlineContainerMeta & { type: 'content_control'; tag?: string })
  | (DocxOutlineContainerMeta & {
      type: 'revision'
      revisionId: string
      revisionKind: 'insert' | 'delete' | 'move_from' | 'move_to'
    })

export type DocxVisualSummary = {
  count: number
  kinds: DocxVisualKind[]
}

export type DocxOutlineNode =
  | DocxOutlineParagraphNode
  | DocxOutlineTableNode
  | DocxOutlineCellNode
  | DocxOutlineContainerNode

type DocxDetailedNodeMeta = {
  nodeId: string
  nodeIndex: number
  layoutMode: DocxLayoutMode
  previousNodeId?: string
  nextNodeId?: string
  story: DocxStoryRef
}

export type DocxDetailedParagraphNode = DocxDetailedNodeMeta & Omit<DocxReadParagraphNode, 'nodeId'>

export type DocxDetailedTableNode = DocxDetailedNodeMeta & Omit<DocxReadTableNode, 'nodeId'>

export type DocxDetailedCellNode = DocxDetailedNodeMeta & {
  type: 'table_cell'
  tableNodeId: string
  row: number
  col: number
  style?: DocxReadTableCellNode['style']
  text: string
  children: DocxReadContentNode[]
}

type DocxDetailedContainerMeta = DocxDetailedNodeMeta & {
  text: string
  children: DocxReadContentNode[]
}

export type DocxDetailedContainerNode =
  | (DocxDetailedContainerMeta & { type: 'content_control'; tag?: string })
  | (DocxDetailedContainerMeta & {
      type: 'revision'
      revisionId: string
      revisionKind: 'insert' | 'delete' | 'move_from' | 'move_to'
    })

export type DocxDetailedNode =
  | DocxDetailedParagraphNode
  | DocxDetailedTableNode
  | DocxDetailedCellNode
  | DocxDetailedContainerNode

export type DocxSearchMode = z.infer<typeof docxSearchModeSchema>
export type DocxCreateRootNode = z.infer<typeof docxCreateRootNodeSchema>
export type DocxReadVisualsRequest = z.infer<typeof docxReadVisualsSchema>
export type DocxContentNodeDraft = z.infer<typeof docxContentNodeDraftSchema>
export type DocxContentEditRequest = z.infer<typeof docxContentEditSchema>
export type DocxFormatRequest = z.infer<typeof docxFormatSchema>
export type DocxTableEditRequest = z.infer<typeof docxTableEditSchema>
export type DocxMediaEditRequest = z.infer<typeof docxMediaEditSchema>
export type DocxCommentsRevisionsRequest = z.infer<typeof docxCommentsRevisionsSchema>
export type DocxNodeOutlineRequest = z.infer<typeof docxOutlineSchema>
export type DocxNodeSearchRequest = z.infer<typeof docxSearchSchema>
export type DocxNodeReadRequest = z.infer<typeof docxReadNodesSchema>

export type DocxSearchMatch = {
  nodeId: string
  nodeIndex: number
  type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
  matchText: string
  textContext: string
  tableNodeId?: string
  story: DocxStoryRef
  before?: DocxSearchNeighbor[]
  after?: DocxSearchNeighbor[]
}

export type DocxSearchNeighbor = {
  nodeId: string
  nodeIndex: number
  type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
  textPreview: string
}

export type DocxOutlineSegment = {
  story: DocxStoryRef['type']
  fromNodeIndex: number
  toNodeIndex: number
  textMap: string
}

export type DocxChangedNode = {
  action:
    | 'inserted'
    | 'replace_node'
    | 'insert_nodes'
    | 'delete_node'
    | 'table_update'
    | 'replace_text'
    | 'format'
  nodeId: string
  beforeText: string
  afterText: string
}

export type DocxCreatedNode = {
  nodeId: string
  type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
}

export type DocxValidationProblem = {
  code: string
  message: string
}

export type DocxOpenStats = {
  rootNodeCount: number
}

export type DocxCapabilityToolsInput = WorkspaceCapabilityBuildInput<DocxToolContext>

export type DocxRevision = {
  revisionRef: string
  docId: string
  parentRevisionRef?: string
  createdAt: number
  summary?: string
  changedNodes?: DocxChangedNode[]
  ops?: DocxOperation[]
  createdNodes?: DocxCreatedNode[]
  createdNodesByOperation?: DocxCreatedNode[][]
  opNextDocIds?: string[]
}

export type DocxReplaySnapshotNode = {
  nodeId: string
  nodeIndex: number
  kind: 'paragraph' | 'table' | 'content_control' | 'revision'
  story: DocxStoryRef
  rawXml: string
  spec: DocxNodeSpec
  structureFingerprint: string
  visuals: Array<{ visualId: string; kind: DocxVisualKind }>
  tableCellNodeIds: string[]
  tableCells?: Array<{
    nodeId: string
    row: number
    col: number
    text: string
    rawXml: string
    structureFingerprint: string
    visuals: Array<{ visualId: string; kind: DocxVisualKind }>
  }>
}

export type DocxReplaySnapshot = {
  packageFingerprint: string
  nodes: DocxReplaySnapshotNode[]
  nodeById: Map<string, DocxReplaySnapshotNode>
  tableNodeIdByCellNodeId: Map<string, string>
}

export type DocxReadSessionCache = {
  outlineByCacheKey: Map<string, { nodes: DocxOutlineNode[] }>
  detailByNodeId: Map<string, DocxDetailedNode>
}

export type DocxReadSession = {
  sourcePath: string
  docId: string
  stats: DocxOpenStats
  currentRevisionRef: string
  diskFingerprint: DocxDiskFingerprint
  cache: DocxReadSessionCache
}

export type DocxDiskFingerprint = {
  checksum: string
  byteSize: number
  modifiedAt: number
}

export type DocxReplaySession = {
  sourcePath: string
  targetMode: 'update' | 'create'
  sourceDocId: string
  activeDocId: string
  activeRevisionRef: string
  nextRevisionNumber: number
  stats: DocxOpenStats
  diskFingerprint: DocxDiskFingerprint
  sourceSnapshot: DocxReplaySnapshot
  activeSnapshot: DocxReplaySnapshot
  docIdByRevisionRef: Map<string, string>
  revisionRefByDocId: Map<string, string>
  revisionByDocId: Map<string, DocxRevision>
  nodeById: Map<string, DocxReplayNode>
  rootNodeIds: string[]
}

export type DocxReviewState =
  | 'normal'
  | 'formatted'
  | 'inserted'
  | 'deleted'
  | 'replaced-old'
  | 'replaced-new'

export type DocxTableCellReviewChange = {
  rowIndex: number
  colIndex: number
  kind: 'formatted' | 'replaced'
  before: DocxTableCellSpec
  after: DocxTableCellSpec
}

export type DocxReplayNode = {
  reviewId: string
  nodeId: string
  nodeIndex: number
  kind: 'paragraph' | 'table' | 'content_control' | 'revision'
  story: DocxStoryRef
  sourceOrigin: 'source' | 'generated'
  reviewState: DocxReviewState
  parentNodeId?: string
  sourceNodeId?: string
  currentNodeId?: string
  predecessorNodeId?: string
  successorNodeId?: string
  replacedFromNodeId?: string
  anchorFromNodeId?: string
  anchorSide?: 'before' | 'after'
  spec: DocxNodeSpec
  structureFingerprint: string
  visualIds: string[]
  createdRevisionRef: string
  changedRevisionRef?: string
  reviewQueries?: string[]
  tableCellChanges?: DocxTableCellReviewChange[]
}

export type DocxCapabilityToolsRuntimeState = {
  sourcePathByDocId: Map<string, string>
  readSessionBySourcePath: Map<string, DocxReadSession>
  replaySessionBySourcePath: Map<string, DocxReplaySession>
}
