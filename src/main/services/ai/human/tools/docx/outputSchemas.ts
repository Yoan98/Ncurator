import { z } from 'zod/v4'
import { toolResourceContextSchema } from '../../schema'

const docxResultCodeSchema = z.enum([
  'ok',
  'failed',
  'invalid_input',
  'approval_denied',
  'workspace_required',
  'result_too_large'
])

const docxLayoutModeSchema = z.enum(['normal', 'positioned'])

const docxTextRunOutputSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional()
})

const docxOutlineParagraphBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('paragraph'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  style: z.string(),
  headingLevel: z.number().optional(),
  text: z.string()
})

const docxOutlineTableBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  rows: z.number().int(),
  cols: z.number().int(),
  text: z.string()
})

const docxOutlineCellBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table_cell'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  tableBlockId: z.string(),
  row: z.number().int(),
  col: z.number().int(),
  text: z.string()
})

const docxOutlineBlockOutputSchema = z.discriminatedUnion('type', [
  docxOutlineParagraphBlockOutputSchema,
  docxOutlineTableBlockOutputSchema,
  docxOutlineCellBlockOutputSchema
])

const docxDetailedParagraphBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('paragraph'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  style: z.string(),
  headingLevel: z.number().optional(),
  text: z.string(),
  runs: z.array(docxTextRunOutputSchema)
})

type DocxDetailedParagraphBlockOutput = z.infer<typeof docxDetailedParagraphBlockOutputSchema>

const docxDetailedCellOutputSchema: z.ZodType<{
  blockId: string
  layoutMode: z.infer<typeof docxLayoutModeSchema>
  row: number
  col: number
  paragraphs: DocxDetailedParagraphBlockOutput[]
}> = z.object({
  blockId: z.string(),
  layoutMode: docxLayoutModeSchema,
  row: z.number().int(),
  col: z.number().int(),
  paragraphs: z.array(docxDetailedParagraphBlockOutputSchema)
})

const docxDetailedTableBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  rows: z.number().int(),
  cols: z.number().int(),
  text: z.string(),
  cells: z.array(docxDetailedCellOutputSchema)
})

const docxDetailedCellBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table_cell'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  tableBlockId: z.string(),
  row: z.number().int(),
  col: z.number().int(),
  text: z.string(),
  paragraphs: z.array(docxDetailedParagraphBlockOutputSchema)
})

const docxDetailedBlockOutputSchema = z.discriminatedUnion('type', [
  docxDetailedParagraphBlockOutputSchema,
  docxDetailedTableBlockOutputSchema,
  docxDetailedCellBlockOutputSchema
])

const docxChangedBlockOutputSchema = z.object({
  action: z.enum([
    'inserted',
    'replace_block',
    'insert_after',
    'insert_before',
    'delete_block',
    'update_table_cell',
    'replace_text',
    'style_text'
  ]),
  blockId: z.string(),
  beforeText: z.string(),
  afterText: z.string()
})

const docxCreatedBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.enum(['paragraph', 'table', 'table_cell'])
})

const docxPostWriteReadbackOutputSchema = z.object({
  regions: z.array(
    z.object({
      fromBlockId: z.string(),
      fromBlockIndex: z.number().int(),
      toBlockId: z.string(),
      toBlockIndex: z.number().int(),
      blocks: z.array(docxDetailedBlockOutputSchema)
    })
  )
})

const docxBaseOutputSchema = z.object({
  ok: z.boolean(),
  code: docxResultCodeSchema,
  summary: z.string().optional(),
  sourcePath: z.string().optional(),
  currentRevisionRef: z.string().optional(),
  resourceContext: toolResourceContextSchema.optional()
})

export const docxOutlineOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  currentRevisionRef: z.string(),
  blocks: z.array(docxOutlineBlockOutputSchema)
})

export const docxSearchOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  currentRevisionRef: z.string(),
  mode: z.enum(['literal', 'regex', 'semantic']),
  effectiveQuery: z.string(),
  appliedAliases: z.array(
    z.object({
      from: z.string(),
      to: z.string()
    })
  ),
  totalMatchCount: z.number().int(),
  returnedMatchCount: z.number().int(),
  matches: z.array(
    z.object({
      blockId: z.string(),
      blockIndex: z.number().int(),
      type: z.enum(['paragraph', 'table', 'table_cell']),
      matchedText: z.string(),
      previousBlockId: z.string().optional(),
      nextBlockId: z.string().optional(),
      tableBlockId: z.string().optional(),
      text: z.string(),
      offsets: z.array(z.object({ start: z.number().int(), end: z.number().int() })).optional(),
      score: z.number().optional()
    })
  ),
  warnings: z.array(z.string())
})

export const docxReadBlocksOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  currentRevisionRef: z.string(),
  fromBlockIndex: z.number().int(),
  toBlockIndex: z.number().int(),
  blocks: z.array(docxDetailedBlockOutputSchema)
})

export const docxHistoryOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  currentRevisionRef: z.string(),
  revisions: z.array(
    z.object({
      revisionRef: z.string(),
      parentRevisionRef: z.string().optional(),
      createdAt: z.number(),
      isCurrent: z.boolean(),
      summary: z.string(),
      changedBlocks: z.array(docxChangedBlockOutputSchema)
    })
  )
})

export const docxWriteOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  previousRevisionRef: z.string(),
  currentRevisionRef: z.string(),
  created: z.boolean().optional(),
  changedBlocks: z.array(docxChangedBlockOutputSchema),
  createdBlocks: z.array(docxCreatedBlockOutputSchema),
  warnings: z.array(z.string()),
  postWriteReadback: docxPostWriteReadbackOutputSchema
})

export const docxRollbackOutputSchema = docxBaseOutputSchema.extend({
  ok: z.literal(true),
  code: z.literal('ok'),
  summary: z.string(),
  sourcePath: z.string(),
  previousRevisionRef: z.string(),
  currentRevisionRef: z.string()
})
