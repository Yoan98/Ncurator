import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

const KB_SEARCH_EXAMPLE: JsonObject = {
  queryText: 'approval denied terminal artifact requirement',
  limit: 3
}

const KB_LIST_DOCUMENTS_EXAMPLE: JsonObject = {
  keyword: 'weekly risk',
  page: 1,
  pageSize: 5
}

const KB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  parallelSafe: true,
  defaultResourceKey: 'local-kb'
})

export const KB_CHUNK_SEARCH_SCHEMA = z.object({
  queryText: z.string(),
  limit: z.number().optional(),
  sourceType: z.enum(['all', 'file', 'web']).optional(),
  documentIds: z.array(z.string()).optional()
})

export const KB_LIST_DOCUMENTS_SCHEMA = z.object({
  keyword: z.string().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  documentIds: z.array(z.string()).optional()
})

const KB_SEARCH_ARGS = [
  {
    name: 'queryText',
    type: 'string',
    required: true,
    description: '检索问题、事实目标或关键词。'
  },
  {
    name: 'limit',
    type: 'number',
    required: false,
    description: '最多返回多少个 chunk，默认 10，上限 50。'
  },
  {
    name: 'sourceType',
    type: '"all" | "file" | "web"',
    required: false,
    description: '限定来源类型。',
    enumValues: ['all', 'file', 'web']
  },
  {
    name: 'documentIds',
    type: 'string[]',
    required: false,
    description: '可选；主动缩小到指定文档 ID 列表，仍不能跳出当前工作区范围。'
  }
] as const

const KB_RETURNS = [
  {
    name: 'rows',
    type: 'Array<chunk result>',
    description: '命中的知识片段列表。'
  }
] as const

const createKbChunkSearchSpec = (input: {
  name: 'kb_hybrid_search_chunks' | 'kb_vector_search_chunks' | 'kb_fts_search_chunks'
  purpose: string
  whenToUse: string
}): HumanToolSpec<z.infer<typeof KB_CHUNK_SEARCH_SCHEMA>, typeof input.name, 'kb-evidence-query'> => ({
  name: input.name,
  familyId: 'kb',
  skillIds: ['kb-evidence-query'],
  requiresWorkspace: true,
  schema: KB_CHUNK_SEARCH_SCHEMA,
  promptSpec: {
    name: input.name,
    purpose: input.purpose,
    whenToUse: input.whenToUse,
    preconditions: ['queryText 不能为空。', '默认搜索范围是当前工作区知识库。'],
    args: [...KB_SEARCH_ARGS],
    returns: [...KB_RETURNS],
    examples: [
      {
        goal: '在当前工作区知识库中检索 approval denied 相关规范',
        args: KB_SEARCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: KB_EXECUTION_META
})

export const KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_hybrid_search_chunks',
  purpose: '在当前工作区知识库上做 hybrid 检索，综合关键词与向量召回。',
  whenToUse: '默认首选的 KB 取证入口；当任务要在当前工作区知识库中找内容、提取事实或找证据时优先使用。'
})

export const KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_vector_search_chunks',
  purpose: '做纯向量语义检索。',
  whenToUse: 'hybrid 没召回到合适结果，但你仍需要扩大语义召回范围时使用。'
})

export const KB_FTS_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_fts_search_chunks',
  purpose: '做纯关键词全文检索。',
  whenToUse: '需要命中固定术语、精确短语或明确关键词时使用。'
})

export const KB_LIST_DOCUMENTS_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_LIST_DOCUMENTS_SCHEMA>,
  'kb_list_documents',
  'kb-document-discovery'
> = {
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-document-discovery'],
  requiresWorkspace: true,
  schema: KB_LIST_DOCUMENTS_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    purpose: '列出当前工作区范围内的知识库文档。',
    whenToUse: '只有在需要先缩小候选文档范围、提高定位精度、或 search 结果过散时使用。',
    preconditions: ['若已选资料和命中 chunk 已经足够，通常不需要再 list_documents。'],
    args: [
      {
        name: 'keyword',
        type: 'string',
        required: false,
        description: '按文档名关键词过滤。'
      },
      {
        name: 'page',
        type: 'number',
        required: false,
        description: '页码，默认 1。'
      },
      {
        name: 'pageSize',
        type: 'number',
        required: false,
        description: '每页数量，默认 20，上限 50。'
      },
      {
        name: 'documentIds',
        type: 'string[]',
        required: false,
        description: '可选；进一步缩小到指定文档 ID 列表。'
      }
    ],
    returns: [
      {
        name: 'items',
        type: 'Array<{ id: string; name: string; source_type: string }>',
        description: '文档列表。'
      },
      {
        name: 'total',
        type: 'number',
        description: '命中文档总数。'
      }
    ],
    examples: [
      {
        goal: '先列出名称中包含 weekly risk 的候选知识文档',
        args: KB_LIST_DOCUMENTS_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

export const KB_TOOL_SPECS = [
  KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC,
  KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC,
  KB_FTS_SEARCH_CHUNKS_TOOL_SPEC,
  KB_LIST_DOCUMENTS_TOOL_SPEC
] as const
