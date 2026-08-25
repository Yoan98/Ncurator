import type { DocxToolContext } from '../../../types'
import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import {
  blockSpecSchema,
  docxBlockInputSchema,
  docxCreateBlockSchema,
  docxEditActionSchema,
  docxEditSchema,
  docxOutlineRequestSchema,
  docxReadRequestSchema,
  docxReadVisualsSchema,
  docxSearchRequestSchema,
  docOpSchema,
  docxSearchModeSchema,
  paragraphSpecSchema,
  runSpecSchema,
  tableCellSpecSchema,
  tableSpecSchema
} from './schemas'
import type {
  DocxParagraphStyle,
  DocxReadBlockNode,
  DocxReadParagraphNode,
  DocxReadTableCellNode,
  DocxReadTableNode,
  DocxVisualKind
} from './nodeTypes'

export type * from './nodeTypes'

export type DocxTextRunSpec = z.infer<typeof runSpecSchema>
export type DocxParagraphSpec = z.infer<typeof paragraphSpecSchema>
export type DocxTableCellSpec = z.infer<typeof tableCellSpecSchema>
export type DocxTableSpec = z.infer<typeof tableSpecSchema>
export type DocxBlockSpec = z.infer<typeof blockSpecSchema>
export type DocxOp = z.infer<typeof docOpSchema>
export type DocxLayoutMode = 'normal' | 'positioned'

export type DocxBlockWrapper =
  | { key: string; type: 'content_control'; tag?: string }
  | { key: string; type: 'revision'; kind: 'insert' | 'move_to' }

export type DocxOutlineParagraphBlock = {
  blockId: string
  type: 'paragraph'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  style?: DocxParagraphStyle
  text: string
  visuals?: DocxVisualSummary
}

export type DocxOutlineTableBlock = {
  blockId: string
  type: 'table'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  rows: number
  cols: number
  text: string
  visuals?: DocxVisualSummary
}

export type DocxOutlineCellBlock = {
  blockId: string
  type: 'table_cell'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  tableBlockId: string
  row: number
  col: number
  text: string
  visuals?: DocxVisualSummary
}

export type DocxVisualSummary = {
  count: number
  kinds: DocxVisualKind[]
}

export type DocxOutlineBlock =
  | DocxOutlineParagraphBlock
  | DocxOutlineTableBlock
  | DocxOutlineCellBlock

type DocxDetailedBlockMeta = {
  blockId: string
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  wrapperPath?: DocxBlockWrapper[]
}

export type DocxDetailedParagraphBlock = DocxDetailedBlockMeta &
  Omit<DocxReadParagraphNode, 'nodeId'>

export type DocxDetailedTableBlock = DocxDetailedBlockMeta & Omit<DocxReadTableNode, 'nodeId'>

export type DocxDetailedCellBlock = DocxDetailedBlockMeta & {
  type: 'table_cell'
  tableBlockId: string
  row: number
  col: number
  style?: DocxReadTableCellNode['style']
  text: string
  children: DocxReadBlockNode[]
}

export type DocxDetailedBlock =
  | DocxDetailedParagraphBlock
  | DocxDetailedTableBlock
  | DocxDetailedCellBlock

export type DocxSearchMode = z.infer<typeof docxSearchModeSchema>
export type DocxCreateBlock = z.infer<typeof docxCreateBlockSchema>
export type DocxBlockInput = z.infer<typeof docxBlockInputSchema>
export type DocxEditAction = z.infer<typeof docxEditActionSchema>
export type DocxEditRequest = z.infer<typeof docxEditSchema>
export type DocxOutlineRequest = z.infer<typeof docxOutlineRequestSchema>
export type DocxSearchRequest = z.infer<typeof docxSearchRequestSchema>
export type DocxReadRequest = z.infer<typeof docxReadRequestSchema>
export type DocxReadVisualsRequest = z.infer<typeof docxReadVisualsSchema>
export type DocxSearchMatch = {
  blockId: string
  blockIndex: number
  type: 'paragraph' | 'table' | 'table_cell'
  matchedText: string
  previousBlockId?: string
  nextBlockId?: string
  tableBlockId?: string
  text: string
  offsets?: Array<{ start: number; end: number }>
  score?: number
}

export type DocxChangedBlock = {
  action:
    | 'inserted'
    | 'replace_block'
    | 'insert_after'
    | 'insert_before'
    | 'delete_block'
    | 'update_table_cell'
    | 'replace_text'
    | 'style'
  blockId: string
  beforeText: string
  afterText: string
}

export type DocxCreatedBlock = {
  blockId: string
  type: 'paragraph' | 'table' | 'table_cell'
}

export type DocxValidationProblem = {
  code: string
  message: string
}

export type DocxOpenMeta = {
  title: string
  creator: string
  lastModifiedBy: string
  description: string
  defaultFont: string
}

export type DocxOpenStats = {
  blockCount: number
  bodyBlockCount: number
  paragraphCount: number
  tableCount: number
  imageCount: number
  visualCount: number
  visualKinds: DocxVisualKind[]
  charCount: number
}

export type DocxCapabilityToolsInput = WorkspaceCapabilityBuildInput<DocxToolContext> & {
  safePreviewChars: number
  modelContextWindowTokens: number
}

export type SemanticDocIndexEntry = {
  blockId: string
  blockType: 'paragraph' | 'table_cell'
  blockIndex: number
  previousBlockId?: string
  nextBlockId?: string
  tableBlockId?: string
  text: string
  embedding: Float32Array
}

export type SemanticDocIndex = {
  entries: SemanticDocIndexEntry[]
}

export type DocxSnapshotLineageEntry = {
  docId: string
  parentDocId?: string
  createdAt: number
}

export type DocxRevision = {
  revisionRef: string
  docId: string
  parentRevisionRef?: string
  createdAt: number
  summary?: string
  changedBlocks?: DocxChangedBlock[]
  ops?: DocxOp[]
  createdBlocks?: DocxCreatedBlock[]
  createdBlocksByOp?: DocxCreatedBlock[][]
  opNextDocIds?: string[]
}

export type DocxReplaySnapshotBlock = {
  blockId: string
  blockIndex: number
  kind: 'paragraph' | 'table'
  rawXml: string
  spec: DocxBlockSpec
  structureFingerprint: string
  visuals: Array<{ visualId: string; kind: DocxVisualKind }>
  tableCellBlockIds: string[]
  tableCells?: Array<{
    blockId: string
    row: number
    col: number
    text: string
    rawXml: string
    structureFingerprint: string
    visuals: Array<{ visualId: string; kind: DocxVisualKind }>
  }>
}

export type DocxReplaySnapshot = {
  blocks: DocxReplaySnapshotBlock[]
  blockById: Map<string, DocxReplaySnapshotBlock>
  tableBlockIdByCellBlockId: Map<string, string>
}

export type DocxReadSessionCache = {
  outlineByCacheKey: Map<string, { blocks: DocxOutlineBlock[] }>
  detailByBlockId: Map<string, DocxDetailedBlock>
}

export type DocxReadSession = {
  sourcePath: string
  docId: string
  meta: DocxOpenMeta
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
  meta: DocxOpenMeta
  stats: DocxOpenStats
  diskFingerprint: DocxDiskFingerprint
  sourceSnapshot: DocxReplaySnapshot
  activeSnapshot: DocxReplaySnapshot
  docIdByRevisionRef: Map<string, string>
  revisionRefByDocId: Map<string, string>
  revisionByDocId: Map<string, DocxRevision>
  nodeById: Map<string, DocxReplayNode>
  bodyNodeIds: string[]
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
  nodeId: string
  blockId: string
  blockIndex: number
  kind: 'paragraph' | 'table'
  sourceOrigin: 'source' | 'generated'
  reviewState: DocxReviewState
  parentNodeId?: string
  sourceBlockId?: string
  currentBlockId?: string
  predecessorNodeId?: string
  successorNodeId?: string
  replacedFromNodeId?: string
  anchorFromNodeId?: string
  anchorSide?: 'before' | 'after'
  spec: DocxBlockSpec
  structureFingerprint: string
  visualIds: string[]
  createdRevisionRef: string
  changedRevisionRef?: string
  reviewQuery?: string
  tableCellChanges?: DocxTableCellReviewChange[]
}

export type DocxCapabilityToolsRuntimeState = {
  sourcePathByDocId: Map<string, string>
  semanticIndexByDocId: Map<string, SemanticDocIndex>
  snapshotEntryByDocId: Map<string, DocxSnapshotLineageEntry>
  revisionEntryByDocId: Map<string, DocxRevision>
  readSessionBySourcePath: Map<string, DocxReadSession>
  replaySessionBySourcePath: Map<string, DocxReplaySession>
}

export type DocxSnapshotResolvedLocator = {
  field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
  stableLocators: DocxStableLocator[]
}

export type DocxSnapshotResolvedToolCall = {
  toolName: string
  sourcePath: string
  locators: DocxSnapshotResolvedLocator[]
}

export type DocxStableLocatorKind = 'paragraph' | 'table' | 'table_cell'

export type DocxStableLocator = {
  nodeId: string
  sourceBlockId?: string
  currentBlockIdAtResolve?: string
  blockIndexAtResolve: number
  previousVisibleNodeId?: string
  nextVisibleNodeId?: string
  kind: DocxStableLocatorKind
  contentFingerprint: string
  tableNodeId?: string
  tableSourceBlockId?: string
  tableFingerprint?: string
  cellBlockId?: string
  rowIndex?: number
  colIndex?: number
  cellContentFingerprint?: string
}
