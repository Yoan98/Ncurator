import { z } from 'zod/v4'
import { jsonObjectSchema } from '../../toolSchemas'

export const KB_SEARCH_SCHEMA = z.object({
  queryText: z.string().min(1),
  strategy: z.enum(['auto', 'semantic', 'keyword']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  sourceType: z.enum(['all', 'file', 'web']).optional(),
  documentIds: z.array(z.string()).optional()
})

export const KB_LIST_DOCUMENTS_SCHEMA = z.object({
  sourceNameQuery: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  documentIds: z.array(z.string()).optional()
})

const kbSearchResultItemSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    documentName: z.string(),
    documentId: z.string().optional(),
    sourceType: z.string().optional(),
    filePath: z.string().optional(),
    sourceUrl: z.string().optional(),
    metadata: z.union([z.string(), jsonObjectSchema]).optional(),
    createdAt: z.number().optional()
  })
  .strict()

const kbListDocumentItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceType: z.string(),
    workspaceId: z.string().optional(),
    filePath: z.string().optional(),
    createdAt: z.number(),
    importStatus: z.number(),
    sourceId: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourceTitle: z.string().optional(),
    normalizedSourceUrl: z.string().optional(),
    fetchedAt: z.number().optional(),
    updatedAt: z.number().optional(),
    lastError: z.string().optional()
  })
  .strict()

export const KB_SEARCH_OUTPUT_SCHEMA = z
  .object({
    items: z.array(kbSearchResultItemSchema),
    total: z.number(),
    error: z.string().optional()
  })
  .strict()

export const KB_LIST_DOCUMENTS_OUTPUT_SCHEMA = z
  .object({
    items: z.array(kbListDocumentItemSchema),
    total: z.number(),
    error: z.string().optional()
  })
  .strict()
