import { z } from 'zod/v4'
import type { JsonValue } from '../../../../../../shared/types'
import {
  docxParagraphStyleSchema,
  docxRunStyleSchema,
  docxTableCellStyleSchema,
  docxTableRowStyleSchema,
  docxTableStyleSchema
} from './schemas'

export const docxResultCodeSchema = z.enum([
  'ok',
  'failed',
  'invalid_input',
  'approval_denied',
  'workspace_required',
  'result_too_large'
])

const docxLayoutModeSchema = z.enum(['normal', 'positioned'])

const docxVisualSummaryOutputSchema = z
  .object({
    count: z.number().int().positive(),
    kinds: z.array(z.enum(['image', 'chart', 'diagram', 'shape', 'embedded_object'])).min(1)
  })
  .strict()

const docxOutlineParagraphBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('paragraph'),
  blockIndex: z.number().int(),
  layoutMode: docxLayoutModeSchema,
  previousBlockId: z.string().optional(),
  nextBlockId: z.string().optional(),
  style: docxParagraphStyleSchema.optional(),
  headingLevel: z.number().optional(),
  text: z.string(),
  visuals: docxVisualSummaryOutputSchema.optional()
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
  text: z.string(),
  visuals: docxVisualSummaryOutputSchema.optional()
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
  text: z.string(),
  visuals: docxVisualSummaryOutputSchema.optional()
})

const docxOutlineBlockOutputSchema = z.discriminatedUnion('type', [
  docxOutlineParagraphBlockOutputSchema,
  docxOutlineTableBlockOutputSchema,
  docxOutlineCellBlockOutputSchema
])

const docxReadNodeOutputSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }).strict(),
    z.object({ type: z.literal('tab') }).strict(),
    z.object({ type: z.literal('break'), kind: z.enum(['line', 'page', 'column']) }).strict(),
    z
      .object({
        type: z.literal('run'),
        nodeId: z.string(),
        style: docxRunStyleSchema.optional(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('hyperlink'),
        target: z.string().optional(),
        anchor: z.string().optional(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('content_control'),
        tag: z.string().optional(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('revision'),
        kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('field'),
        instruction: z.string(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('visual'),
        visualId: z.string(),
        kind: z.enum(['image', 'chart', 'diagram', 'shape', 'embedded_object']),
        altText: z.string().optional(),
        children: z.array(docxReadNodeOutputSchema).optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('paragraph'),
        nodeId: z.string(),
        style: docxParagraphStyleSchema.optional(),
        text: z.string(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('table'),
        nodeId: z.string(),
        style: docxTableStyleSchema.optional(),
        rows: z.number().int(),
        cols: z.number().int(),
        text: z.string(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('table_row'),
        nodeId: z.string(),
        row: z.number().int(),
        style: docxTableRowStyleSchema.optional(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict(),
    z
      .object({
        type: z.literal('table_cell'),
        blockId: z.string().optional(),
        nodeId: z.string().optional(),
        row: z.number().int(),
        col: z.number().int(),
        style: docxTableCellStyleSchema.optional(),
        text: z.string(),
        children: z.array(docxReadNodeOutputSchema)
      })
      .strict()
      .refine((node) => Boolean(node.blockId) !== Boolean(node.nodeId), {
        message: 'table_cell requires exactly one of blockId or nodeId'
      })
  ])
)

const docxDetailedParagraphBlockOutputSchema = z
  .object({
    blockId: z.string(),
    type: z.literal('paragraph'),
    blockIndex: z.number().int(),
    layoutMode: docxLayoutModeSchema,
    previousBlockId: z.string().optional(),
    nextBlockId: z.string().optional(),
    style: docxParagraphStyleSchema.optional(),
    headingLevel: z.number().optional(),
    text: z.string(),
    children: z.array(docxReadNodeOutputSchema)
  })
  .strict()

const docxDetailedTableBlockOutputSchema = z
  .object({
    blockId: z.string(),
    type: z.literal('table'),
    blockIndex: z.number().int(),
    layoutMode: docxLayoutModeSchema,
    previousBlockId: z.string().optional(),
    nextBlockId: z.string().optional(),
    style: docxTableStyleSchema.optional(),
    rows: z.number().int(),
    cols: z.number().int(),
    text: z.string(),
    children: z.array(docxReadNodeOutputSchema)
  })
  .strict()

const docxDetailedCellBlockOutputSchema = z
  .object({
    blockId: z.string(),
    type: z.literal('table_cell'),
    blockIndex: z.number().int(),
    layoutMode: docxLayoutModeSchema,
    previousBlockId: z.string().optional(),
    nextBlockId: z.string().optional(),
    tableBlockId: z.string(),
    row: z.number().int(),
    col: z.number().int(),
    style: docxTableCellStyleSchema.optional(),
    text: z.string(),
    children: z.array(docxReadNodeOutputSchema)
  })
  .strict()

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
    'style'
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
  sourcePath: z.string().optional()
})

export const docxOutlineOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
  totalBlockCount: z.number().int().min(0),
  blocks: z.array(docxOutlineBlockOutputSchema)
})

export const docxSearchOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
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
  sourcePath: z.string(),
  fromBlockIndex: z.number().int(),
  toBlockIndex: z.number().int(),
  blocks: z.array(docxDetailedBlockOutputSchema)
})

export const docxWriteOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
  changedBlocks: z.array(docxChangedBlockOutputSchema),
  createdBlocks: z.array(docxCreatedBlockOutputSchema),
  warnings: z.array(z.string()),
  postWriteReadback: docxPostWriteReadbackOutputSchema
})

export const docxReadVisualsOutputSchema = z
  .object({
    sourcePath: z.string(),
    results: z.array(
      z.union([
        z.object({ visualId: z.string(), text: z.string().min(1) }).strict(),
        z.object({ visualId: z.string(), error: z.string().min(1) }).strict()
      ])
    )
  })
  .strict()
