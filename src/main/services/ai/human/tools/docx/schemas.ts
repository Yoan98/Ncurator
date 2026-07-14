import { z } from 'zod/v4'

export const runSpecSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional()
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
export const docxTextStyleSchema = z.object({
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional()
})

export const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_document')
  }),
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    content: blockSpecSchema
  }),
  z.object({
    type: z.literal('insert_after'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('insert_before'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('delete_block'),
    blockId: z.string().min(1)
  }),
  z.object({
    type: z.literal('update_table_cell'),
    blockId: z.string().min(1),
    content: z.array(paragraphSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
    blockIds: z.array(z.string().min(1)).optional()
  }),
  z.object({
    type: z.literal('style_text'),
    blockId: z.string().min(1),
    query: z.string().min(1),
    style: docxTextStyleSchema
  })
])

export const docxCreateHeadingBlockSchema = z.object({
  type: z.literal('heading'),
  text: z.string().min(1),
  level: z.number().int().min(1).max(6).optional()
})

export const docxCreateParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  text: z.string()
})

export const docxCreateTableBlockSchema = z.object({
  type: z.literal('table'),
  rows: z.array(z.array(z.string()).min(1)).min(1)
})

export const docxCreateBlockSchema = z.discriminatedUnion('type', [
  docxCreateHeadingBlockSchema,
  docxCreateParagraphBlockSchema,
  docxCreateTableBlockSchema
])

export const docxCreateSchema = z.object({
  sourcePath: z.string().min(1),
  blocks: z.array(docxCreateBlockSchema).optional()
})

export const docxEditCreateDocumentActionSchema = z
  .object({
    type: z.literal('create_document'),
    blocks: z.array(docxCreateBlockSchema).optional()
  })
  .strict()

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

export const docxParagraphEditActionSchema = z.enum(['insert_before', 'insert_after'])

const docxParagraphEditInsertBaseSchema = z
  .object({
    sourcePath: z.string().min(1),
    anchorBlockId: z.string().min(1),
    paragraphs: z.array(z.string()).min(1)
  })
  .strict()

export const docxParagraphEditSchema = z.discriminatedUnion('action', [
  docxParagraphEditInsertBaseSchema.extend({
    action: z.literal('insert_before')
  }),
  docxParagraphEditInsertBaseSchema.extend({
    action: z.literal('insert_after')
  })
])

const docxEditInsertBlocksActionSchema = z
  .object({
    type: z.literal('insert_blocks'),
    position: z.enum(['before', 'after']),
    anchorBlockId: z.string().min(1),
    blocks: z.array(docxCreateBlockSchema).min(1)
  })
  .strict()

export const docxHeadingEditActionSchema = z.enum(['insert_before', 'insert_after'])

const docxHeadingEditInsertBaseSchema = z
  .object({
    sourcePath: z.string().min(1),
    anchorBlockId: z.string().min(1),
    headings: z
      .array(
        z
          .object({
            level: z.number().int().min(1).max(6),
            text: z.string().min(1)
          })
          .strict()
      )
      .min(1)
  })
  .strict()

export const docxHeadingEditSchema = z.discriminatedUnion('action', [
  docxHeadingEditInsertBaseSchema.extend({
    action: z.literal('insert_before')
  }),
  docxHeadingEditInsertBaseSchema.extend({
    action: z.literal('insert_after')
  })
])

export const docxTableEditActionSchema = z.enum(['insert_before', 'insert_after', 'update_cell'])

const docxTableInsertSchema = z
  .object({
    sourcePath: z.string().min(1),
    anchorBlockId: z.string().min(1),
    rows: z.array(z.array(z.string()).min(1)).min(1)
  })
  .strict()

const docxTableUpdateCellSchema = z
  .object({
    sourcePath: z.string().min(1),
    cellBlockId: z.string().min(1),
    text: z.string()
  })
  .strict()

export const docxTableEditSchema = z.discriminatedUnion('action', [
  docxTableInsertSchema.extend({
    action: z.literal('insert_before')
  }),
  docxTableInsertSchema.extend({
    action: z.literal('insert_after')
  }),
  docxTableUpdateCellSchema.extend({
    action: z.literal('update_cell')
  })
])

const docxEditUpdateTableCellActionSchema = z
  .object({
    type: z.literal('update_table_cell'),
    cellBlockId: z.string().min(1),
    text: z.string()
  })
  .strict()

export const docxTextEditSchema = z.object({
  sourcePath: z.string().min(1),
  query: z.string().min(1),
  replace: z.string(),
  blockIds: z.array(z.string().min(1)).optional()
})

const docxEditReplaceBlockActionSchema = z
  .object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    block: docxCreateBlockSchema
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

export const docxDeleteSchema = z
  .object({
    sourcePath: z.string().min(1),
    blockIds: z.array(z.string().min(1)).min(1)
  })
  .strict()

const docxEditDeleteBlocksActionSchema = z
  .object({
    type: z.literal('delete_blocks'),
    blockIds: z.array(z.string().min(1)).min(1)
  })
  .strict()

export const docxTextStyleEditSchema = z.object({
  sourcePath: z.string().min(1),
  blockId: z.string().min(1),
  query: z.string().min(1),
  style: docxTextStyleSchema
})

const docxEditStyleTextActionSchema = z
  .object({
    type: z.literal('style_text'),
    blockId: z.string().min(1),
    query: z.string().min(1),
    style: docxTextStyleSchema
  })
  .strict()

export const docxEditActionSchema = z.discriminatedUnion('type', [
  docxEditCreateDocumentActionSchema,
  docxEditInsertBlocksActionSchema,
  docxEditReplaceBlockActionSchema,
  docxEditReplaceTextActionSchema,
  docxEditStyleTextActionSchema,
  docxEditUpdateTableCellActionSchema,
  docxEditDeleteBlocksActionSchema
])

export const docxEditSchema = z
  .object({
    sourcePath: z.string().min(1),
    actions: z.array(docxEditActionSchema).min(1)
  })
  .strict()
