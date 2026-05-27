import type { DocxToolContext } from '../../../types'
import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import {
  blockSpecSchema,
  docxCreateBlockSchema,
  docxCreateSchema,
  docxDeleteSchema,
  docxHeadingEditActionSchema,
  docxHeadingEditSchema,
  docxHistoryRequestSchema,
  docxOutlineRequestSchema,
  docxParagraphEditActionSchema,
  docxParagraphEditSchema,
  docxReadRequestSchema,
  docxSearchRequestSchema,
  docOpSchema,
  docxSearchModeSchema,
  docxRollbackRequestSchema,
  docxTableEditActionSchema,
  docxTableEditSchema,
  docxTextEditSchema,
  docxTextStyleEditSchema,
  docxTextStyleSchema,
  paragraphSpecSchema,
  runSpecSchema,
  tableCellSpecSchema,
  tableSpecSchema
} from './schemas'

export type DocxTextRunSpec = z.infer<typeof runSpecSchema>
export type DocxParagraphSpec = z.infer<typeof paragraphSpecSchema>
export type DocxTableCellSpec = z.infer<typeof tableCellSpecSchema>
export type DocxTableSpec = z.infer<typeof tableSpecSchema>
export type DocxBlockSpec = z.infer<typeof blockSpecSchema>
export type DocxOp = z.infer<typeof docOpSchema>
export type DocxLayoutMode = 'normal' | 'positioned'

export type DocxOutlineParagraphBlock = {
  blockId: string
  type: 'paragraph'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  style: string
  text: string
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
}

export type DocxOutlineBlock = DocxOutlineParagraphBlock | DocxOutlineTableBlock | DocxOutlineCellBlock

export type DocxDetailedParagraphBlock = {
  blockId: string
  type: 'paragraph'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  style: string
  text: string
  runs: DocxTextRunSpec[]
}

export type DocxDetailedTableCell = {
  blockId: string
  layoutMode: DocxLayoutMode
  row: number
  col: number
  paragraphs: DocxDetailedParagraphBlock[]
}

export type DocxDetailedTableBlock = {
  blockId: string
  type: 'table'
  blockIndex: number
  layoutMode: DocxLayoutMode
  previousBlockId?: string
  nextBlockId?: string
  rows: number
  cols: number
  text: string
  cells: DocxDetailedTableCell[]
}

export type DocxDetailedCellBlock = {
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
  paragraphs: DocxDetailedParagraphBlock[]
}

export type DocxDetailedBlock =
  | DocxDetailedParagraphBlock
  | DocxDetailedTableBlock
  | DocxDetailedCellBlock

export type DocxPostWriteReadbackRegion = {
  startBlockId: string
  fromBlockIndex: number
  endBlockId: string
  toBlockIndex: number
  blocks: DocxDetailedBlock[]
}

export type DocxPostWriteReadback = {
  regions: DocxPostWriteReadbackRegion[]
}

export type DocxWriteReadbackWindowPolicy = {
  beforeBlockCount: number
  afterBlockCount: number
}

export type DocxWriteReadbackAction =
  | 'create_document'
  | 'insert_before'
  | 'insert_after'
  | 'replace_block'
  | 'delete_block'
  | 'update_table_cell'
  | 'replace_text'
  | 'style_text'

export type DocxSearchMode = z.infer<typeof docxSearchModeSchema>
export type DocxCreateBlock = z.infer<typeof docxCreateBlockSchema>
export type DocxCreateRequest = z.infer<typeof docxCreateSchema>
export type DocxDeleteRequest = z.infer<typeof docxDeleteSchema>
export type DocxOutlineRequest = z.infer<typeof docxOutlineRequestSchema>
export type DocxSearchRequest = z.infer<typeof docxSearchRequestSchema>
export type DocxReadRequest = z.infer<typeof docxReadRequestSchema>
export type DocxParagraphEditAction = z.infer<typeof docxParagraphEditActionSchema>
export type DocxParagraphEditRequest = z.infer<typeof docxParagraphEditSchema>
export type DocxHeadingEditAction = z.infer<typeof docxHeadingEditActionSchema>
export type DocxHeadingEditRequest = z.infer<typeof docxHeadingEditSchema>
export type DocxTableEditAction = z.infer<typeof docxTableEditActionSchema>
export type DocxTableEditRequest = z.infer<typeof docxTableEditSchema>
export type DocxTextEditRequest = z.infer<typeof docxTextEditSchema>
export type DocxTextStyle = z.infer<typeof docxTextStyleSchema>
export type DocxTextStyleEditRequest = z.infer<typeof docxTextStyleEditSchema>
export type DocxHistoryRequest = z.infer<typeof docxHistoryRequestSchema>
export type DocxRollbackRequest = z.infer<typeof docxRollbackRequestSchema>

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
    | 'style_text'
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
  paragraphCount: number
  tableCount: number
  imageCount: number
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
}

export type DocxReplaySnapshotBlock = {
  blockId: string
  blockIndex: number
  kind: 'paragraph' | 'table'
  spec: DocxBlockSpec
  tableCellBlockIds: string[]
  tableCells?: Array<{
    blockId: string
    row: number
    col: number
    text: string
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
  cache: DocxReadSessionCache
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
  sourceSnapshot: DocxReplaySnapshot
  activeSnapshot: DocxReplaySnapshot
  docIdByRevisionRef: Map<string, string>
  revisionRefByDocId: Map<string, string>
  revisionByDocId: Map<string, DocxRevision>
  nodeById: Map<string, DocxReplayNode>
  bodyNodeIds: string[]
  viewArtifacts: Partial<Record<DocxViewArtifact['kind'], DocxViewArtifact>>
}

export type DocxReviewState =
  | 'normal'
  | 'formatted'
  | 'inserted'
  | 'deleted'
  | 'replaced-old'
  | 'replaced-new'

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
  createdRevisionRef: string
  changedRevisionRef?: string
  reviewQuery?: string
}

export type DocxViewArtifact = {
  kind: 'working' | 'review' | 'committed'
  path: string
  checksum?: string
  byteSize?: number
  createdAt: number
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
