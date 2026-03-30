import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

const KB_SEARCH_EXAMPLE: JsonObject = {
  queryText: 'approval denied terminal artifact requirement',
  limit: 3
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
    description: '进一步缩小到指定文档 ID 列表；不能跳出当前运行范围。'
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
  commonMistakes: string[]
}): HumanToolSpec<z.infer<typeof KB_CHUNK_SEARCH_SCHEMA>, typeof input.name, 'kb-evidence-query'> => ({
  name: input.name,
  familyId: 'kb',
  skillIds: ['kb-evidence-query'],
  requiresWorkspace: false,
  schema: KB_CHUNK_SEARCH_SCHEMA,
  promptSpec: {
    name: input.name,
    purpose: input.purpose,
    whenToUse: input.whenToUse,
    preconditions: ['queryText 不能为空。', '检索默认受当前已选资料范围约束。'],
    args: [...KB_SEARCH_ARGS],
    returns: [...KB_RETURNS],
    commonMistakes: input.commonMistakes,
    examples: [
      {
        goal: '在当前资料范围内检索 approval denied 相关规范',
        args: KB_SEARCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: KB_EXECUTION_META
})

export const KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_hybrid_search_chunks',
  purpose: '在本地知识库上做 hybrid 检索，综合关键词与向量召回。',
  whenToUse: '默认首选的 KB 取证入口；当任务要基于当前已选资料回答、提取事实或找证据时优先使用。',
  commonMistakes: [
    '已有明确 chunk 证据时，不要为了“再确认一次”反复检索。',
    'documentIds 只能进一步缩小范围，不能突破当前已选资料。'
  ]
})

export const KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_vector_search_chunks',
  purpose: '做纯向量语义检索。',
  whenToUse: 'hybrid 没召回到合适结果，但你仍需要扩大语义召回范围时使用。',
  commonMistakes: ['不要把 vector 当成默认第一步；通常先用 hybrid 更稳。']
})

export const KB_FTS_SEARCH_CHUNKS_TOOL_SPEC = createKbChunkSearchSpec({
  name: 'kb_fts_search_chunks',
  purpose: '做纯关键词全文检索。',
  whenToUse: '需要命中固定术语、精确短语或明确关键词时使用。',
  commonMistakes: ['如果用户诉求是“找相近语义”，不要先用 fts。']
})

export const KB_LIST_DOCUMENTS_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_LIST_DOCUMENTS_SCHEMA>,
  'kb_list_documents',
  'kb-document-discovery'
> = {
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-document-discovery'],
  requiresWorkspace: false,
  schema: KB_LIST_DOCUMENTS_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    purpose: '列出当前范围内的知识库文档。',
    whenToUse: '只有在资料范围不清楚、需要先找候选文档、或 search 没有给出可用结果时使用。',
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
        description: '进一步缩小到指定文档 ID 列表。'
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
    commonMistakes: ['不要在已经拿到明确 chunk 证据后再 list_documents 做重复确认。']
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

export const KB_TOOL_SPECS = [
  KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC,
  KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC,
  KB_FTS_SEARCH_CHUNKS_TOOL_SPEC,
  KB_LIST_DOCUMENTS_TOOL_SPEC
] as const
