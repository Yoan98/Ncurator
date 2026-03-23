import type { AiTaskResultCode } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { z } from 'zod/v4'
import {
  blockSpecSchema,
  docOpSchema,
  docxSearchModeSchema,
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
  style: string
  text: string
}

export type DocxOutlineTableBlock = {
  blockId: string
  type: 'table'
  rows: number
  cols: number
  preview: string
}

export type DocxOutlineCellBlock = {
  blockId: string
  type: 'table_cell'
  tableBlockId: string
  row: number
  col: number
  text: string
}

export type DocxOutlineBlock = DocxOutlineParagraphBlock | DocxOutlineTableBlock | DocxOutlineCellBlock

export type DocxDetailedParagraphBlock = {
  blockId: string
  type: 'paragraph'
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
  rows: number
  cols: number
  preview: string
  cells: DocxDetailedTableCell[]
}

export type DocxDetailedCellBlock = {
  blockId: string
  type: 'table_cell'
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

export type DocxSearchMatch = {
  blockId: string
  text: string
  offsets: Array<{ start: number; end: number }>
}

export type DocxChangedBlock = {
  action: 'replace_block' | 'insert_after' | 'insert_before' | 'delete_block' | 'update_table_cell' | 'replace_text'
  blockId: string
  beforeText: string
  afterText: string
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

export type DocxSnapshot = {
  docId: string
  sourcePath: string
  createdAt: number
  parentDocId?: string
  bufferBase64: string
}

export type DocxOperationResult<T extends object> = T & {
  ok: boolean
  code: DocxToolResultCode
  summary: string
}

export type EmitActivityInput = {
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}

export type DocxCapabilityToolsInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
  workspaceRootPath: string
  safePreviewChars: number
  emitActivity: (input: EmitActivityInput) => void
}

export type SemanticDocIndexEntry = {
  blockId: string
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

export type DocxCapabilityToolsRuntimeState = {
  lastDocId?: string
  sourcePathByDocId: Map<string, string>
  semanticIndexByDocId: Map<string, SemanticDocIndex>
  snapshotEntryByDocId: Map<string, DocxSnapshotLineageEntry>
}
