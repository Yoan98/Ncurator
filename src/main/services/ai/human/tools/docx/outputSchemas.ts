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
  'result_too_large'
])

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
  text: z.string(),
  visuals: docxVisualSummaryOutputSchema.optional()
})

const docxOutlineTableBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table'),
  blockIndex: z.number().int(),
  rows: z.number().int(),
  cols: z.number().int(),
  text: z.string(),
  visuals: docxVisualSummaryOutputSchema.optional()
})

const docxOutlineCellBlockOutputSchema = z.object({
  blockId: z.string(),
  type: z.literal('table_cell'),
  blockIndex: z.number().int(),
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

const textNode = z.object({ type: z.literal('text'), text: z.string() }).strict()
const tabNode = z.object({ type: z.literal('tab') }).strict()
const breakNode = z
  .object({ type: z.literal('break'), kind: z.enum(['line', 'page', 'column']) })
  .strict()
const visualKind = z.enum(['image', 'chart', 'diagram', 'shape', 'embedded_object'])

const nestedBlockNode: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [
    nestedParagraphNode,
    nestedTableNode,
    blockControlNode,
    blockRevisionNode
  ])
)
const visualBlockNode: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [nestedParagraphNode, nestedTableNode])
)
const visualNode = z.lazy(() =>
  z
    .object({
      type: z.literal('visual'),
      visualId: z.string(),
      kind: visualKind,
      altText: z.string().optional(),
      children: z.array(visualBlockNode).optional()
    })
    .strict()
)
const runChildNode = z.lazy(() =>
  z.discriminatedUnion('type', [textNode, tabNode, breakNode, visualNode])
)
const runNode = z.lazy(() =>
  z
    .object({
      type: z.literal('run'),
      nodeId: z.string(),
      style: docxRunStyleSchema.optional(),
      children: z.array(runChildNode)
    })
    .strict()
)
const hyperlinkNode = z.lazy(() =>
  z
    .object({
      type: z.literal('hyperlink'),
      target: z.string().optional(),
      anchor: z.string().optional(),
      children: z.array(runNode)
    })
    .strict()
)
const inlineNode: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [
    runNode,
    hyperlinkNode,
    inlineControlNode,
    inlineRevisionNode,
    fieldNode
  ])
)
const inlineControlNode = z.lazy(() =>
  z
    .object({
      type: z.literal('content_control'),
      tag: z.string().optional(),
      children: z.array(inlineNode)
    })
    .strict()
)
const inlineRevisionNode = z.lazy(() =>
  z
    .object({
      type: z.literal('revision'),
      kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
      children: z.array(inlineNode)
    })
    .strict()
)
const fieldNode = z.lazy(() =>
  z
    .object({ type: z.literal('field'), instruction: z.string(), children: z.array(inlineNode) })
    .strict()
)
const nestedParagraphNode = z.lazy(() =>
  z
    .object({
      type: z.literal('paragraph'),
      nodeId: z.string(),
      style: docxParagraphStyleSchema.optional(),
      children: z.array(inlineNode)
    })
    .strict()
)
const nestedCellNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      nodeId: z.string(),
      row: z.number().int(),
      col: z.number().int(),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(nestedBlockNode)
    })
    .strict()
)
const blockCellNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      blockId: z.string(),
      row: z.number().int(),
      col: z.number().int(),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(nestedBlockNode)
    })
    .strict()
)
const rowNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_row'),
      nodeId: z.string(),
      row: z.number().int(),
      style: docxTableRowStyleSchema.optional(),
      children: z.array(z.union([nestedCellNode, blockCellNode]))
    })
    .strict()
)
const nestedTableNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table'),
      nodeId: z.string(),
      style: docxTableStyleSchema.optional(),
      children: z.array(rowNode)
    })
    .strict()
)
const blockControlNode = z.lazy(() =>
  z
    .object({
      type: z.literal('content_control'),
      tag: z.string().optional(),
      children: z.array(nestedBlockNode)
    })
    .strict()
)
const blockRevisionNode = z.lazy(() =>
  z
    .object({
      type: z.literal('revision'),
      kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
      children: z.array(nestedBlockNode)
    })
    .strict()
)
const rootParagraphNode = z.lazy(() =>
  z
    .object({
      type: z.literal('paragraph'),
      blockId: z.string(),
      blockIndex: z.number().int(),
      style: docxParagraphStyleSchema.optional(),
      children: z.array(inlineNode)
    })
    .strict()
)
const rootTableNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table'),
      blockId: z.string(),
      blockIndex: z.number().int(),
      style: docxTableStyleSchema.optional(),
      children: z.array(rowNode)
    })
    .strict()
)
const rootCellNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      blockId: z.string(),
      blockIndex: z.number().int(),
      tableBlockId: z.string(),
      row: z.number().int(),
      col: z.number().int(),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(nestedBlockNode)
    })
    .strict()
)
const docxReadRootNodeOutputSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.discriminatedUnion('type', [
    rootParagraphNode,
    rootTableNode,
    rootCellNode,
    z.lazy(() =>
      z
        .object({
          type: z.literal('content_control'),
          tag: z.string().optional(),
          children: z.array(docxReadRootNodeOutputSchema)
        })
        .strict()
    ),
    z.lazy(() =>
      z
        .object({
          type: z.literal('revision'),
          kind: z.enum(['insert', 'move_to']),
          children: z.array(docxReadRootNodeOutputSchema)
        })
        .strict()
    )
  ])
) as z.ZodType<JsonValue>

const docxPostWriteReadbackOutputSchema = z.object({
  regions: z.array(
    z.object({
      fromBlockId: z.string(),
      fromBlockIndex: z.number().int(),
      toBlockId: z.string(),
      toBlockIndex: z.number().int(),
      blocks: z.array(docxReadRootNodeOutputSchema)
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
  )
})

export const docxReadBlocksOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
  blocks: z.array(docxReadRootNodeOutputSchema)
})

export const docxWriteOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
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
