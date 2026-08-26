import { z } from 'zod/v4'
import type { JsonValue } from '../../../../../../shared/types'
import {
  docxParagraphStyleSchema,
  docxRunStyleSchema,
  docxTableCellStyleSchema,
  docxTableRowStyleSchema,
  docxTableStyleSchema
} from './schemas'

const docxVisualSummaryOutputSchema = z
  .object({
    count: z.number().int().positive(),
    kinds: z.array(z.enum(['image', 'chart', 'diagram', 'shape', 'embedded_object'])).min(1)
  })
  .strict()

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

const docxOutlineParagraphNodeOutputSchema = z
  .object({
    nodeId: z.string(),
    type: z.literal('paragraph'),
    nodeIndex: z.number().int(),
    story: docxOutlineStoryOutputSchema,
    textPreview: z.string(),
    styleId: z.string().optional(),
    visuals: docxVisualSummaryOutputSchema.optional()
  })
  .strict()

const docxOutlineTableNodeOutputSchema = z
  .object({
    nodeId: z.string(),
    type: z.literal('table'),
    nodeIndex: z.number().int(),
    story: docxOutlineStoryOutputSchema,
    textPreview: z.string(),
    rows: z.number().int(),
    columns: z.number().int(),
    visuals: docxVisualSummaryOutputSchema.optional()
  })
  .strict()

const docxOutlineContentControlOutputSchema = z
  .object({
    nodeId: z.string(),
    type: z.literal('content_control'),
    nodeIndex: z.number().int(),
    story: docxOutlineStoryOutputSchema,
    textPreview: z.string(),
    tag: z.string().optional()
  })
  .strict()

const docxOutlineRevisionOutputSchema = z
  .object({
    nodeId: z.string(),
    type: z.literal('revision'),
    nodeIndex: z.number().int(),
    story: docxOutlineStoryOutputSchema,
    textPreview: z.string(),
    revisionKind: z.enum(['insert', 'delete', 'move_from', 'move_to'])
  })
  .strict()

const docxOutlineNodeOutputSchema = z.discriminatedUnion('type', [
  docxOutlineParagraphNodeOutputSchema,
  docxOutlineTableNodeOutputSchema,
  docxOutlineContentControlOutputSchema,
  docxOutlineRevisionOutputSchema
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
      visualId: z.string(),
      kind: visualKind,
      altText: z.string().optional(),
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
    startPage: z.number().int().min(1),
    endPage: z.number().int().min(1),
    totalPages: z.number().int().min(1),
    nodes: z.array(docxOutlineNodeOutputSchema)
  })
  .strict()

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
      nodeId: z.string(),
      nodeIndex: z.number().int(),
      type: z.enum(['paragraph', 'table', 'table_cell', 'content_control', 'revision']),
      matchedText: z.string(),
      previousNodeId: z.string().optional(),
      nextNodeId: z.string().optional(),
      tableNodeId: z.string().optional(),
      text: z.string(),
      offsets: z.array(z.object({ start: z.number().int(), end: z.number().int() })).optional(),
      score: z.number().optional(),
      story: docxStoryOutputSchema
    })
  )
})

export const docxReadOutputSchema = docxBaseOutputSchema.extend({
  sourcePath: z.string(),
  nodes: z.array(docxReadRootNodeOutputSchema)
})

export const docxMutationOutputSchema = z
  .object({
    changes: z.array(
      z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.enum(['created', 'updated']),
            node: docxReadRootNodeOutputSchema
          })
          .strict(),
        z.object({ kind: z.literal('deleted'), nodeId: z.string() }).strict(),
        z
          .object({
            kind: z.enum(['style_created', 'style_updated', 'style_deleted']),
            styleId: z.string()
          })
          .strict(),
        z
          .object({
            kind: z.enum(['comment_created', 'comment_updated']),
            comment: z
              .object({
                commentId: z.string(),
                text: z.string(),
                author: z.string(),
                parentCommentId: z.string().optional()
              })
              .strict()
          })
          .strict(),
        z.object({ kind: z.literal('comment_deleted'), commentId: z.string() }).strict(),
        z.object({ kind: z.literal('track_changes_updated'), enabled: z.boolean() }).strict(),
        z
          .object({
            kind: z.literal('revisions_updated'),
            action: z.enum(['accept', 'reject']),
            revisionId: z.string().optional()
          })
          .strict()
      ])
    )
  })
  .strict()

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
