import { z } from 'zod/v4'
import { jsonObjectSchema } from '../../toolSchemas'

export const KB_SEARCH_SCHEMA = z.object({
  queryText: z.string().min(1).describe('检索查询词或语义语句'),
  strategy: z
    .enum(['auto', 'semantic', 'keyword'])
    .optional()
    .describe('检索策略；默认 auto'),
  limit: z.number().int().min(1).max(50).optional().describe('最多返回条数；默认 10'),
  sourceType: z
    .enum(['all', 'file', 'web'])
    .optional()
    .describe('按来源类型过滤；默认 all'),
  documentIds: z.array(z.string()).optional().describe('限定文档 ID 范围')
})

export const KB_LIST_DOCUMENTS_SCHEMA = z.object({
  sourceNameQuery: z.string().optional().describe('按文档名模糊过滤'),
  page: z.number().int().min(1).optional().describe('页码；默认 1'),
  pageSize: z.number().int().min(1).max(50).optional().describe('每页条数；默认 20'),
  documentIds: z.array(z.string()).optional().describe('限定文档 ID 范围')
})

export type KbSearchResultItem = {
  id: string
  text: string
  documentName: string
  documentId?: string
  sourceType?: string
  filePath?: string
  sourceUrl?: string
  metadata?: string | z.infer<typeof jsonObjectSchema>
  createdAt?: number
}

export type KbListDocumentItem = {
  id: string
  name: string
  sourceType: string
  workspaceId?: string
  filePath?: string
  createdAt: number
  importStatus: number
  sourceId?: string
  sourceUrl?: string
  sourceTitle?: string
  normalizedSourceUrl?: string
  fetchedAt?: number
  updatedAt?: number
  lastError?: string
}

export type KbSearchOutput = {
  items: KbSearchResultItem[]
  total: number
  error?: string
}

export type KbListDocumentsOutput = {
  items: KbListDocumentItem[]
  total: number
  error?: string
}
