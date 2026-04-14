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
