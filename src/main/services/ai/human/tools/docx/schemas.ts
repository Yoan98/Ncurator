import { z } from 'zod/v4'
import type {
  DocxCreateBlockNode,
  DocxCreateBreakNode,
  DocxCreateHyperlinkNode,
  DocxCreateParagraphNode,
  DocxCreateRunNode,
  DocxCreateTabNode,
  DocxCreateTableCellNode,
  DocxCreateTableNode,
  DocxCreateTableRowNode,
  DocxCreateTextNode
} from './nodeTypes'

export const docxHexColorSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'color must be exactly 6 hexadecimal characters, for example FF0000')

export const runSpecSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: docxHexColorSchema.optional()
})

export const paragraphSpecSchema = z.object({
  kind: z.literal('paragraph'),
  style: z.string().optional(),
  runs: z.array(runSpecSchema).min(1)
})

export const tableCellSpecSchema = z.object({
  paragraphs: z.array(paragraphSpecSchema).min(1)
})

export const tableSpecSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(z.array(tableCellSpecSchema).min(1)).min(1)
})

export const blockSpecSchema = z.union([paragraphSpecSchema, tableSpecSchema])
export const docxSearchModeSchema = z.enum(['literal', 'regex', 'semantic'])

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional()
const docxPointSchema = z.number().min(0)
const docxLengthSchema = z
  .object({
    value: z.number().positive(),
    unit: z.enum(['pt', 'percent'])
  })
  .strict()
const docxBorderSchema = z
  .object({
    style: z.enum(['none', 'single', 'dashed', 'dotted', 'double']),
    color: docxHexColorSchema.optional(),
    size: z.number().positive().optional()
  })
  .strict()
const docxBordersSchema = z
  .object({
    top: docxBorderSchema.optional(),
    right: docxBorderSchema.optional(),
    bottom: docxBorderSchema.optional(),
    left: docxBorderSchema.optional(),
    insideHorizontal: docxBorderSchema.optional(),
    insideVertical: docxBorderSchema.optional()
  })
  .strict()

export const docxRunStyleSchema = z
  .object({
    color: docxHexColorSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    highlight: docxHexColorSchema.optional(),
    fontFamily: z.string().trim().min(1).optional(),
    fontSize: z.number().positive().optional()
  })
  .strict()

export const docxParagraphStyleSchema = z
  .object({
    styleName: z.string().trim().min(1).optional(),
    alignment: z.enum(['left', 'center', 'right', 'justify']).optional(),
    indent: z
      .object({
        left: docxPointSchema.optional(),
        right: docxPointSchema.optional(),
        firstLine: docxPointSchema.optional(),
        hanging: docxPointSchema.optional()
      })
      .strict()
      .optional(),
    spacing: z
      .object({
        before: docxPointSchema.optional(),
        after: docxPointSchema.optional(),
        line: z.number().positive().optional()
      })
      .strict()
      .optional(),
    keepWithNext: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional()
  })
  .strict()

export const docxTableStyleSchema = z
  .object({
    alignment: z.enum(['left', 'center', 'right']).optional(),
    width: docxLengthSchema.optional(),
    layout: z.enum(['fixed', 'autofit']).optional(),
    borders: docxBordersSchema.optional()
  })
  .strict()

export const docxTableRowStyleSchema = z
  .object({
    height: docxPointSchema.optional(),
    repeatHeader: z.boolean().optional(),
    cantSplit: z.boolean().optional()
  })
  .strict()

export const docxTableCellStyleSchema = z
  .object({
    width: docxLengthSchema.optional(),
    verticalAlignment: z.enum(['top', 'center', 'bottom']).optional(),
    shading: docxHexColorSchema.optional(),
    margins: z
      .object({
        top: docxPointSchema.optional(),
        right: docxPointSchema.optional(),
        bottom: docxPointSchema.optional(),
        left: docxPointSchema.optional()
      })
      .strict()
      .optional(),
    borders: docxBordersSchema.optional()
  })
  .strict()

const docxCreateTextNodeSchema: z.ZodType<DocxCreateTextNode> = z
  .object({ type: z.literal('text'), text: z.string() })
  .strict()
const docxCreateTabNodeSchema: z.ZodType<DocxCreateTabNode> = z
  .object({ type: z.literal('tab') })
  .strict()
const docxCreateBreakNodeSchema: z.ZodType<DocxCreateBreakNode> = z
  .object({ type: z.literal('break'), kind: z.enum(['line', 'page', 'column']).optional() })
  .strict()
const docxCreateRunNodeSchema: z.ZodType<DocxCreateRunNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('run'),
      style: docxRunStyleSchema.optional(),
      children: z
        .array(
          z.union([docxCreateTextNodeSchema, docxCreateTabNodeSchema, docxCreateBreakNodeSchema])
        )
        .min(1)
    })
    .strict()
)
const docxCreateHyperlinkNodeSchema: z.ZodType<DocxCreateHyperlinkNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('hyperlink'),
      target: z.string().trim().min(1).optional(),
      anchor: z.string().trim().min(1).optional(),
      children: z.array(docxCreateRunNodeSchema).min(1)
    })
    .strict()
    .refine((value) => Boolean(value.target || value.anchor), {
      message: 'hyperlink requires target or anchor'
    })
)
const docxCreateParagraphNodeSchema: z.ZodType<DocxCreateParagraphNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('paragraph'),
      style: docxParagraphStyleSchema.optional(),
      children: z.array(z.union([docxCreateRunNodeSchema, docxCreateHyperlinkNodeSchema])).min(1)
    })
    .strict()
)
const docxCreateTableCellNodeSchema: z.ZodType<DocxCreateTableCellNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(docxCreateBlockSchema).min(1)
    })
    .strict()
)
const docxCreateTableRowNodeSchema: z.ZodType<DocxCreateTableRowNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('table_row'),
      style: docxTableRowStyleSchema.optional(),
      children: z.array(docxCreateTableCellNodeSchema).min(1)
    })
    .strict()
)
const docxCreateTableNodeSchema: z.ZodType<DocxCreateTableNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('table'),
      style: docxTableStyleSchema.optional(),
      children: z.array(docxCreateTableRowNodeSchema).min(1)
    })
    .strict()
)

export const docxCreateBlockSchema: z.ZodType<DocxCreateBlockNode> = z.lazy(() =>
  z.union([docxCreateParagraphNodeSchema, docxCreateTableNodeSchema])
)

const runStylePatchSchema = z
  .object({
    kind: z.literal('run'),
    color: nullable(docxHexColorSchema),
    bold: nullable(z.boolean()),
    italic: nullable(z.boolean()),
    underline: nullable(z.boolean()),
    strike: nullable(z.boolean()),
    highlight: nullable(docxHexColorSchema),
    fontFamily: nullable(z.string().trim().min(1)),
    fontSize: nullable(z.number().positive())
  })
  .strict()
const paragraphStylePatchSchema = docxParagraphStyleSchema
  .partial()
  .extend({
    kind: z.literal('paragraph'),
    styleName: nullable(z.string().trim().min(1)),
    alignment: nullable(z.enum(['left', 'center', 'right', 'justify'])),
    indent: nullable(docxParagraphStyleSchema.shape.indent.unwrap()),
    spacing: nullable(docxParagraphStyleSchema.shape.spacing.unwrap()),
    keepWithNext: nullable(z.boolean()),
    pageBreakBefore: nullable(z.boolean())
  })
  .strict()
const tableStylePatchSchema = z
  .object({
    kind: z.literal('table'),
    alignment: nullable(z.enum(['left', 'center', 'right'])),
    width: nullable(docxLengthSchema),
    layout: nullable(z.enum(['fixed', 'autofit'])),
    borders: nullable(docxBordersSchema)
  })
  .strict()
const tableRowStylePatchSchema = z
  .object({
    kind: z.literal('table_row'),
    height: nullable(docxPointSchema),
    repeatHeader: nullable(z.boolean()),
    cantSplit: nullable(z.boolean())
  })
  .strict()
const tableCellStylePatchSchema = z
  .object({
    kind: z.literal('table_cell'),
    width: nullable(docxLengthSchema),
    verticalAlignment: nullable(z.enum(['top', 'center', 'bottom'])),
    shading: nullable(docxHexColorSchema),
    margins: nullable(docxTableCellStyleSchema.shape.margins.unwrap()),
    borders: nullable(docxBordersSchema)
  })
  .strict()

export const docxStylePatchSchema = z
  .discriminatedUnion('kind', [
    runStylePatchSchema,
    paragraphStylePatchSchema,
    tableStylePatchSchema,
    tableRowStylePatchSchema,
    tableCellStylePatchSchema
  ])
  .refine((patch) => Object.keys(patch).some((key) => key !== 'kind'), {
    message: 'style patch must contain at least one property'
  })

export const docxStyleTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text_match'),
      query: z.string().min(1),
      blockIds: z.array(z.string().min(1)).optional()
    })
    .strict(),
  z.object({ type: z.literal('block'), blockId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('node'), nodeId: z.string().min(1) }).strict()
])

export const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_document')
  }),
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    content: docxCreateBlockSchema,
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('insert_after'),
    anchorBlockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1)
  }),
  z.object({
    type: z.literal('insert_before'),
    anchorBlockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1)
  }),
  z.object({
    type: z.literal('delete_block'),
    blockId: z.string().min(1),
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('update_table_cell'),
    blockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1),
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    blockIds: z.array(z.string().min(1)).optional()
  }),
  z.object({
    type: z.literal('style'),
    target: docxStyleTargetSchema,
    patch: docxStylePatchSchema
  })
])

export const docxOutlineRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('percent'),
      fromPercent: z.number().min(0).max(100),
      toPercent: z.number().min(0).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal('block_index'),
      fromBlockIndex: z.number().int().min(0),
      toBlockIndex: z.number().int().min(0)
    })
    .strict()
])

export const docxOutlineRequestSchema = z
  .object({
    sourcePath: z.string().min(1),
    ranges: z.array(docxOutlineRangeSchema).min(1)
  })
  .strict()

export const docxSearchRequestSchema = z.object({
  sourcePath: z.string().min(1),
  query: z.string().min(1),
  mode: docxSearchModeSchema.optional(),
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

export const docxReadRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('block_index'),
      fromBlockIndex: z.number().int().min(0),
      toBlockIndex: z.number().int().min(0)
    })
    .strict(),
  z
    .object({
      type: z.literal('block_ids'),
      blockIds: z.array(z.string().min(1)).min(1)
    })
    .strict()
])

export const docxReadRequestSchema = z
  .object({
    sourcePath: z.string().min(1),
    range: docxReadRangeSchema
  })
  .strict()

const docxEditInsertBlocksActionSchema = z
  .object({
    type: z.literal('insert_blocks'),
    position: z.enum(['before', 'after']),
    anchorBlockId: z.string().min(1).optional(),
    blocks: z.array(docxCreateBlockSchema).min(1)
  })
  .strict()

const docxEditUpdateTableCellActionSchema = z
  .object({
    type: z.literal('update_table_cell'),
    cellBlockId: z.string().min(1),
    children: z.array(docxCreateBlockSchema).min(1),
    allowVisualLoss: z.literal(true).optional()
  })
  .strict()

const docxEditReplaceBlockActionSchema = z
  .object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    block: docxCreateBlockSchema,
    allowVisualLoss: z.literal(true).optional()
  })
  .strict()

const docxEditReplaceTextActionSchema = z
  .object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    blockIds: z.array(z.string().min(1)).optional()
  })
  .strict()

const docxEditDeleteBlocksActionSchema = z
  .object({
    type: z.literal('delete_blocks'),
    blockIds: z.array(z.string().min(1)).min(1),
    allowVisualLoss: z.literal(true).optional()
  })
  .strict()

const docxEditStyleActionSchema = z
  .object({
    type: z.literal('style'),
    target: docxStyleTargetSchema,
    patch: docxStylePatchSchema
  })
  .strict()

export const docxEditActionSchema = z.discriminatedUnion('type', [
  docxEditInsertBlocksActionSchema,
  docxEditReplaceBlockActionSchema,
  docxEditReplaceTextActionSchema,
  docxEditStyleActionSchema,
  docxEditUpdateTableCellActionSchema,
  docxEditDeleteBlocksActionSchema
])

export const docxEditSchema = z
  .object({
    sourcePath: z.string().min(1),
    actions: z.array(docxEditActionSchema).min(1)
  })
  .strict()

export const docxReadVisualsSchema = z
  .object({
    sourcePath: z.string().min(1),
    requests: z
      .array(
        z
          .object({
            visualId: z.string().min(1),
            instruction: z.string().trim().min(1)
          })
          .strict()
      )
      .min(1)
      .max(10)
  })
  .strict()
