import { z } from 'zod/v4'
import type { JsonValue } from '../../../../../../shared/types'
import {
  docxParagraphStyleSchema,
  docxRunStyleSchema,
  docxTableCellStyleSchema,
  docxTableRowStyleSchema,
  docxTableStyleSchema
} from './schemas'
import {
  DOCX_OUTLINE_SEGMENT_MAP_MAX_CHARS,
  DOCX_SEARCH_CONTEXT_NODE_COUNT,
  DOCX_SEARCH_MAX_MATCHES,
  DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS
} from './constants'

const docxStoryOutputSchema = z
  .object({
    storyId: z.string(),
    type: z.enum(['body', 'header', 'footer', 'footnote', 'endnote', 'textbox'])
  })
  .strict()

const docxOutlineStoryOutputSchema = z.enum([
  'body',
  'header',
  'footer',
  'footnote',
  'endnote',
  'textbox'
])

const textNode = z.object({ type: z.literal('text'), text: z.string() }).strict()
const tabNode = z.object({ type: z.literal('tab') }).strict()
const breakNode = z
  .object({ type: z.literal('break'), kind: z.enum(['line', 'page', 'column']) })
  .strict()
const visualKind = z.enum(['image', 'chart', 'diagram', 'shape', 'embedded_object'])

const nestedContentNode: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [
    nestedParagraphNode,
    nestedTableNode,
    contentControlNode,
    revisionNode,
    opaqueNode
  ])
)
const visualContentNode: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [nestedParagraphNode, nestedTableNode])
)
const visualNode = z.lazy(() =>
  z
    .object({
      type: z.literal('visual'),
      nodeId: z.string(),
      kind: visualKind,
      altText: z.string().optional(),
      imagePath: z.string().min(1),
      widthCm: z.number().positive().optional(),
      heightCm: z.number().positive().optional(),
      children: z.array(visualContentNode).optional()
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
      story: docxStoryOutputSchema,
      style: docxRunStyleSchema.optional(),
      children: z.array(runChildNode)
    })
    .strict()
)
const hyperlinkNode = z.lazy(() =>
  z
    .object({
      type: z.literal('hyperlink'),
      nodeId: z.string(),
      story: docxStoryOutputSchema,
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
    fieldNode,
    bookmarkNode,
    mathNode,
    inlineOpaqueNode
  ])
)
const inlineControlNode = z.lazy(() =>
  z
    .object({
      type: z.literal('content_control'),
      nodeId: z.string(),
      story: docxStoryOutputSchema,
      tag: z.string().optional(),
      children: z.array(inlineNode)
    })
    .strict()
)
const inlineRevisionNode = z.lazy(() =>
  z
    .object({
      type: z.literal('revision'),
      nodeId: z.string(),
      revisionId: z.string(),
      kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
      children: z.array(inlineNode)
    })
    .strict()
)
const fieldNode = z.lazy(() =>
  z
    .object({
      type: z.literal('field'),
      nodeId: z.string(),
      instruction: z.string(),
      children: z.array(inlineNode)
    })
    .strict()
)
const bookmarkNode = z
  .object({
    type: z.literal('bookmark'),
    bookmarkId: z.string(),
    kind: z.enum(['start', 'end']),
    name: z.string().optional()
  })
  .strict()
const mathNode = z.object({ type: z.literal('math'), text: z.string() }).strict()
const inlineOpaqueNode = z.lazy(() =>
  z.object({ type: z.literal('opaque'), name: z.string(), children: z.array(inlineNode) }).strict()
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
      children: z.array(nestedContentNode)
    })
    .strict()
)
const rowCellNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      nodeId: z.string(),
      row: z.number().int(),
      col: z.number().int(),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(nestedContentNode)
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
      children: z.array(z.union([nestedCellNode, rowCellNode]))
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
const contentControlNode = z.lazy(() =>
  z
    .object({
      type: z.literal('content_control'),
      nodeId: z.string(),
      tag: z.string().optional(),
      children: z.array(nestedContentNode)
    })
    .strict()
)
const revisionNode = z.lazy(() =>
  z
    .object({
      type: z.literal('revision'),
      nodeId: z.string(),
      revisionId: z.string(),
      kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
      children: z.array(nestedContentNode)
    })
    .strict()
)
const opaqueNode = z.lazy(() =>
  z
    .object({ type: z.literal('opaque'), name: z.string(), children: z.array(nestedContentNode) })
    .strict()
)
const rootParagraphNode = z.lazy(() =>
  z
    .object({
      type: z.literal('paragraph'),
      nodeId: z.string(),
      style: docxParagraphStyleSchema.optional(),
      children: z.array(inlineNode)
    })
    .strict()
)
const rootTableNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table'),
      nodeId: z.string(),
      style: docxTableStyleSchema.optional(),
      children: z.array(rowNode)
    })
    .strict()
)
const rootCellNode = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      nodeId: z.string(),
      tableNodeId: z.string(),
      row: z.number().int(),
      col: z.number().int(),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(nestedContentNode)
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
          nodeId: z.string(),
          story: docxStoryOutputSchema,
          tag: z.string().optional(),
          children: z.array(nestedContentNode)
        })
        .strict()
    ),
    z.lazy(() =>
      z
        .object({
          type: z.literal('revision'),
          nodeId: z.string(),
          story: docxStoryOutputSchema,
          revisionId: z.string(),
          kind: z.enum(['insert', 'delete', 'move_from', 'move_to']),
          children: z.array(nestedContentNode)
        })
        .strict()
    )
  ])
) as z.ZodType<JsonValue>

const docxBaseOutputSchema = z.object({
  sourcePath: z.string().optional()
})

export const docxOutlineOutputSchema = z
  .object({
    fromPercent: z.number().min(0).max(100),
    toPercent: z.number().min(0).max(100),
    fromNodeIndex: z.number().int().min(0),
    toNodeIndex: z.number().int().min(0),
    totalRootCount: z.number().int().min(0),
    segments: z.array(
      z
        .object({
          story: docxOutlineStoryOutputSchema,
          fromNodeIndex: z.number().int().min(0),
          toNodeIndex: z.number().int().min(0),
          textMap: z.string().max(DOCX_OUTLINE_SEGMENT_MAP_MAX_CHARS)
        })
        .strict()
    )
  })
  .strict()

const docxSearchNodeTypeOutputSchema = z.enum([
  'paragraph',
  'table',
  'table_cell',
  'content_control',
  'revision'
])
export const docxSearchOutputSchema = z
  .object({
    sourcePath: z.string(),
    totalMatchCount: z.number().int().min(0),
    matches: z
      .array(
        z
          .object({
            nodeId: z.string(),
            nodeIndex: z.number().int(),
            type: docxSearchNodeTypeOutputSchema,
            story: docxOutlineStoryOutputSchema,
            matchText: z.string(),
            textContext: z.string().max(DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS),
            tableNodeId: z.string().optional(),
            node: docxReadRootNodeOutputSchema,
            beforeNodes: z
              .array(docxReadRootNodeOutputSchema)
              .max(DOCX_SEARCH_CONTEXT_NODE_COUNT)
              .optional(),
            afterNodes: z
              .array(docxReadRootNodeOutputSchema)
              .max(DOCX_SEARCH_CONTEXT_NODE_COUNT)
              .optional()
          })
          .strict()
      )
      .max(DOCX_SEARCH_MAX_MATCHES)
  })
  .strict()

export const docxReadOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
  nodes: z.array(docxReadRootNodeOutputSchema)
})

export const docxMutationOutputSchema = z
  .object({
    createdIds: z.array(z.string().min(1)).min(1).optional()
  })
  .strict()
