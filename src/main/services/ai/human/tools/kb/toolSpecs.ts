import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import { jsonObjectSchema } from '../../toolSchemas'

const KB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'local-kb'
})

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

const kbSearchResultItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  document_name: z.string(),
  document_id: z.string().optional(),
  source_type: z.string().optional(),
  file_path: z.string().optional(),
  source_url: z.string().optional(),
  metadata: z.union([z.string(), jsonObjectSchema]).optional(),
  _distance: z.number().optional(),
  created_at: z.number().optional(),
  _score: z.number().optional(),
  _relevance_score: z.number().optional(),
  document: jsonObjectSchema.optional()
})

const kbListDocumentItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  source_type: z.string(),
  workspace_id: z.string().optional(),
  file_path: z.string().optional(),
  created_at: z.number(),
  import_status: z.number(),
  source_id: z.string().optional(),
  source_url: z.string().optional(),
  source_title: z.string().optional(),
  normalized_source_url: z.string().optional(),
  fetched_at: z.number().optional(),
  updated_at: z.number().optional(),
  last_error: z.string().optional()
})

export const KB_SEARCH_OUTPUT_SCHEMA = z.union([
  z.array(kbSearchResultItemSchema),
  z.object({
    items: z.array(kbSearchResultItemSchema),
    total: z.number(),
    error: z.string().optional()
  })
])

export const KB_LIST_DOCUMENTS_OUTPUT_SCHEMA = z.object({
  items: z.array(kbListDocumentItemSchema),
  total: z.number(),
  error: z.string().optional()
})

export const KB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_SEARCH_SCHEMA>,
  z.infer<typeof KB_SEARCH_OUTPUT_SCHEMA>,
  'kb_search',
  'kb-retrieval'
> = {
  name: 'kb_search',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  requiresWorkspace: true,
  inputSchema: KB_SEARCH_SCHEMA,
  outputSchema: KB_SEARCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'kb_search',
    description: '在工作区知识库中按查询词或语义语句检索内容片段，并返回命中证据、来源文档与内容块信息。'
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

export const KB_LIST_DOCUMENTS_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_LIST_DOCUMENTS_SCHEMA>,
  z.infer<typeof KB_LIST_DOCUMENTS_OUTPUT_SCHEMA>,
  'kb_list_documents',
  'kb-retrieval'
> = {
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  requiresWorkspace: true,
  inputSchema: KB_LIST_DOCUMENTS_SCHEMA,
  outputSchema: KB_LIST_DOCUMENTS_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    description: '查询工作区知识库中已建立索引的文档并支持按文档名过滤，并返回可检索文档的分页列表。'
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

export const KB_TOOL_SPECS = [KB_SEARCH_TOOL_SPEC, KB_LIST_DOCUMENTS_TOOL_SPEC] as const
