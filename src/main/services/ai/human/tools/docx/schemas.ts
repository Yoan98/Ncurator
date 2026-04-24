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

export const openSchema = z.object({
  sourcePath: z.string().min(1)
})

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

export const outlineSchema = z.object({
  sourcePath: z.string().min(1),
  maxBlocks: z.number().int().min(1).max(2000).optional(),
  includeTables: z.boolean().optional(),
  includeCells: z.boolean().optional()
})

export const getBlockSchema = z.object({
  sourcePath: z.string().min(1),
  blockId: z.string().min(1)
})

export const searchSchema = z.object({
  sourcePath: z.string().min(1),
  query: z.string().min(1),
  mode: docxSearchModeSchema,
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

export const applyOpsSchema = z.object({
  sourcePath: z.string().min(1),
  ops: z.array(docOpSchema).min(1)
})

export const historySchema = z.object({
  sourcePath: z.string().min(1),
  maxDepth: z.number().int().min(1).max(100).optional()
})

export const rollbackSchema = z.object({
  sourcePath: z.string().min(1),
  targetVersionRef: z.string().min(1).optional(),
  steps: z.number().int().min(1).max(50).optional()
})

export const docxOutlineRequestSchema = z.object({
  sourcePath: z.string().min(1),
  fromBodyIndex: z.number().int().min(0).optional(),
  maxBlocks: z.number().int().min(1).max(2000).optional()
})

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

export const docxReadRequestSchema = z.object({
  sourcePath: z.string().min(1),
  fromBlockId: z.string().min(1),
  toBlockId: z.string().min(1).optional()
})

export const docxParagraphEditActionSchema = z.enum([
  'insert_before',
  'insert_after',
  'replace_text',
  'delete'
])

export const docxParagraphEditSchema = z
  .object({
    sourcePath: z.string().min(1),
    action: docxParagraphEditActionSchema,
    anchorBlockId: z.string().min(1).optional(),
    blockId: z.string().min(1).optional(),
    text: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (value.action === 'insert_before' || value.action === 'insert_after') {
      if (!value.anchorBlockId) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchorBlockId'],
          message: 'anchorBlockId is required for paragraph insertion'
        })
      }
      if (typeof value.text !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['text'],
          message: 'text is required for paragraph insertion'
        })
      }
      return
    }

    if (!value.blockId) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockId'],
        message: 'blockId is required for paragraph update'
      })
    }
    if (value.action === 'replace_text' && typeof value.text !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'text is required for paragraph replacement'
      })
    }
  })

export const docxHeadingEditActionSchema = z.enum([
  'insert_before',
  'insert_after',
  'replace_text'
])

export const docxHeadingEditSchema = z
  .object({
    sourcePath: z.string().min(1),
    action: docxHeadingEditActionSchema,
    anchorBlockId: z.string().min(1).optional(),
    blockId: z.string().min(1).optional(),
    level: z.number().int().min(1).max(6),
    text: z.string().min(1)
  })
  .superRefine((value, ctx) => {
    if (value.action === 'insert_before' || value.action === 'insert_after') {
      if (!value.anchorBlockId) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchorBlockId'],
          message: 'anchorBlockId is required for heading insertion'
        })
      }
      return
    }

    if (!value.blockId) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockId'],
        message: 'blockId is required for heading replacement'
      })
    }
  })

export const docxTableEditActionSchema = z.enum([
  'insert_before',
  'insert_after',
  'update_cell'
])

export const docxTableEditSchema = z
  .object({
    sourcePath: z.string().min(1),
    action: docxTableEditActionSchema,
    anchorBlockId: z.string().min(1).optional(),
    cellBlockId: z.string().min(1).optional(),
    rows: z.array(z.array(z.string())).min(1).optional(),
    text: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (value.action === 'insert_before' || value.action === 'insert_after') {
      if (!value.anchorBlockId) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchorBlockId'],
          message: 'anchorBlockId is required for table insertion'
        })
      }
      if (!value.rows || value.rows.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows'],
          message: 'rows are required for table insertion'
        })
      }
      return
    }

    if (!value.cellBlockId) {
      ctx.addIssue({
        code: 'custom',
        path: ['cellBlockId'],
        message: 'cellBlockId is required for table cell update'
      })
    }
    if (typeof value.text !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'text is required for table cell update'
      })
    }
  })

export const docxTextEditSchema = z.object({
  sourcePath: z.string().min(1),
  query: z.string().min(1),
  replace: z.string(),
  blockIds: z.array(z.string().min(1)).optional()
})

export const docxTextStyleEditSchema = z.object({
  sourcePath: z.string().min(1),
  blockId: z.string().min(1),
  query: z.string().min(1),
  style: docxTextStyleSchema
})

export const docxHistoryRequestSchema = z.object({
  sourcePath: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional()
})

export const docxRollbackRequestSchema = z.object({
  sourcePath: z.string().min(1),
  revisionRef: z.string().min(1)
})
