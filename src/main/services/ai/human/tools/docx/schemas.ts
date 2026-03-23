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

export const docOpSchema = z.discriminatedUnion('type', [
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
  })
])

export const openSchema = z.object({
  sourcePath: z.string().min(1)
})

export const outlineSchema = z.object({
  docId: z.string().min(1).optional(),
  maxBlocks: z.number().int().min(1).max(2000).optional(),
  includeTables: z.boolean().optional(),
  includeCells: z.boolean().optional()
})

export const getBlockSchema = z.object({
  docId: z.string().min(1).optional(),
  blockId: z.string().min(1)
})

export const searchSchema = z.object({
  docId: z.string().min(1).optional(),
  query: z.string().min(1),
  mode: z.enum(['literal', 'regex', 'semantic']),
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

export const applyOpsSchema = z.object({
  docId: z.string().min(1).optional(),
  ops: z.array(docOpSchema).min(1)
})

export const historySchema = z.object({
  docId: z.string().min(1).optional(),
  maxDepth: z.number().int().min(1).max(100).optional()
})

export const rollbackSchema = z.object({
  docId: z.string().min(1).optional(),
  targetDocId: z.string().min(1).optional(),
  steps: z.number().int().min(1).max(50).optional()
})

export const renderPreviewSchema = z.object({
  docId: z.string().min(1).optional(),
  format: z.enum(['html', 'png', 'pdf']),
  range: z
    .object({
      fromBlockId: z.string().optional(),
      toBlockId: z.string().optional()
    })
    .optional()
})

export const saveSchema = z.object({
  docId: z.string().min(1),
  outPath: z.string().min(1),
  overwrite: z.boolean().optional()
})

export const validateSchema = z.object({
  docId: z.string().min(1).optional()
})
