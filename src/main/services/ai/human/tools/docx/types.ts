import type { AiTaskResultCode } from '../../../../../../shared/types'
import type { DocxToolContext } from '../../../types'
import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import {
  blockSpecSchema,
  docxHeadingEditActionSchema,
  docxHeadingEditSchema,
  docxHistoryRequestSchema,
  docxOutlineRequestSchema,
  docxParagraphEditActionSchema,
  docxParagraphEditSchema,
  docxReadRequestSchema,
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

export type DocxToolResultCode = Extract<
  AiTaskResultCode,
  'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
>

export type DocxTextRunSpec = z.infer<typeof runSpecSchema>
export type DocxParagraphSpec = z.infer<typeof paragraphSpecSchema>
export type DocxTableCellSpec = z.infer<typeof tableCellSpecSchema>
export type DocxTableSpec = z.infer<typeof tableSpecSchema>
export type DocxBlockSpec = z.infer<typeof blockSpecSchema>
export type DocxOp = z.infer<typeof docOpSchema>

export type DocxOutlineParagraphBlock = {
  blockId: string
  type: 'paragraph'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  style: string
  text: string
}

export type DocxOutlineTableBlock = {
  blockId: string
  type: 'table'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  rows: number
  cols: number
  preview: string
}

export type DocxOutlineCellBlock = {
  blockId: string
  type: 'table_cell'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  tableBlockId: string
  row: number
  col: number
  text: string
}

export type DocxOutlineBlock = DocxOutlineParagraphBlock | DocxOutlineTableBlock | DocxOutlineCellBlock

export type DocxDetailedParagraphBlock = {
  blockId: string
  type: 'paragraph'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  style: string
  text: string
  runs: DocxTextRunSpec[]
}

export type DocxDetailedTableCell = {
  blockId: string
  row: number
  col: number
  paragraphs: DocxDetailedParagraphBlock[]
}

export type DocxDetailedTableBlock = {
  blockId: string
  type: 'table'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  rows: number
  cols: number
  preview: string
  cells: DocxDetailedTableCell[]
}

export type DocxDetailedCellBlock = {
  blockId: string
  type: 'table_cell'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
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

export type DocxSearchMode = z.infer<typeof docxSearchModeSchema>
export type DocxOutlineRequest = z.infer<typeof docxOutlineRequestSchema>
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
  blockType: 'paragraph' | 'table' | 'table_cell'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
  tableBlockId?: string
  text: string
  offsets: Array<{ start: number; end: number }>
}

export type DocxChangedBlock = {
  action:
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
}

export type SemanticDocIndexEntry = {
  blockId: string
  blockType: 'paragraph' | 'table_cell'
  bodyIndex: number
  previousBodyBlockId?: string
  nextBodyBlockId?: string
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

export type DocxVersionEntry = {
  versionRef: string
  docId: string
  parentVersionRef?: string
  createdAt: number
  summary?: string
  changedBlocks?: DocxChangedBlock[]
}

export type DocxDocumentSession = {
  sourcePath: string
  activeDocId: string
  activeVersionRef: string
  nextVersionNumber: number
  meta: DocxOpenMeta
  stats: DocxOpenStats
  docIdByVersionRef: Map<string, string>
  versionRefByDocId: Map<string, string>
}

export type DocxCapabilityToolsRuntimeState = {
  sourcePathByDocId: Map<string, string>
  semanticIndexByDocId: Map<string, SemanticDocIndex>
  snapshotEntryByDocId: Map<string, DocxSnapshotLineageEntry>
  versionEntryByDocId: Map<string, DocxVersionEntry>
  documentSessionBySourcePath: Map<string, DocxDocumentSession>
}
