import type { JsonObject } from '../../../../../../../shared/types'
import { z } from 'zod/v4'
import type { ToolPromptArgSpec, ToolPromptReturnSpec } from '../../../types'
import { createStaticCapabilityToolDefinition } from '../factories'

const KB_SEARCH_EXAMPLE: JsonObject = {
  queryText: 'approval denied terminal artifact requirement',
  limit: 3
}

const KB_SEARCH_ARGS: ToolPromptArgSpec[] = [
  {
    name: 'queryText',
    type: 'string',
    required: true,
    description: '检索问题或关键词。'
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
    description: '进一步缩小到指定文档 ID 列表。'
  }
]

const KB_EXECUTION_META = {
  mutability: 'read_only' as const,
  parallelSafe: true,
  defaultResourceKey: 'local-kb'
}

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

const createKbSearchReturns = (type: string): ToolPromptReturnSpec[] => [
  {
    name: 'rows',
    type,
    description: '命中的知识片段列表。'
  }
]

const createKbChunkSearchDefinition = (input: {
  name: 'kb_hybrid_search_chunks' | 'kb_vector_search_chunks' | 'kb_fts_search_chunks'
  purpose: string
  whenToUse: string
  commonMistakes: string[]
  returnType: string
  examples?: Array<{ goal: string; args: JsonObject }>
}) =>
  createStaticCapabilityToolDefinition({
    name: input.name,
    familyId: 'kb',
    skillIds: ['kb-evidence-query'],
    requiresWorkspace: false,
    schema: KB_CHUNK_SEARCH_SCHEMA,
    promptSpec: {
      name: input.name,
      purpose: input.purpose,
      whenToUse: input.whenToUse,
      preconditions: [
        input.name === 'kb_hybrid_search_chunks'
          ? 'queryText 不能为空。'
          : 'queryText 不能为空。'
      ],
      args: KB_SEARCH_ARGS,
      returns: createKbSearchReturns(input.returnType),
      commonMistakes: input.commonMistakes,
      examples: input.examples
    },
    executionMeta: KB_EXECUTION_META
  })

export const KB_HYBRID_SEARCH_CHUNKS_CONTRACT = createKbChunkSearchDefinition({
  name: 'kb_hybrid_search_chunks',
  purpose: '在本地知识库上做 hybrid 检索，综合关键词与向量召回。',
  whenToUse: '默认首选的 KB 检索入口；需要先召回本地证据时优先使用。',
  commonMistakes: [
    '如果已有单文档命中证据，不要再重复检索或改用 list_documents 再确认一次。',
    'documentIds 只能缩小范围，不能跳出当前 selectedDocumentIds。'
  ],
  returnType:
    'Array<{ text: string; document_id: string; document_name: string; source_type: string; _score: number }>',
  examples: [
    {
      goal: '在当前范围内检索 approval denied 相关规范',
      args: KB_SEARCH_EXAMPLE
    }
  ]
})

export const KB_VECTOR_SEARCH_CHUNKS_CONTRACT = createKbChunkSearchDefinition({
  name: 'kb_vector_search_chunks',
  purpose: '做纯向量语义检索。',
  whenToUse: 'hybrid 没召回到语义相近内容，但你仍需要更宽松的语义匹配时使用。',
  commonMistakes: ['不要把 vector 当成默认第一步；通常先用 hybrid。'],
  returnType: 'Array<chunk result>'
})

export const KB_FTS_SEARCH_CHUNKS_CONTRACT = createKbChunkSearchDefinition({
  name: 'kb_fts_search_chunks',
  purpose: '做纯关键词全文检索。',
  whenToUse: '需要精确关键词命中、固定短语、或明确术语检索时使用。',
  commonMistakes: ['如果用户诉求是“找相近语义”，不要先上 fts。'],
  returnType: 'Array<chunk result>'
})

export const KB_LIST_DOCUMENTS_CONTRACT = createStaticCapabilityToolDefinition({
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-document-discovery'],
  requiresWorkspace: false,
  schema: KB_LIST_DOCUMENTS_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    purpose: '列出当前范围内的知识库文档。',
    whenToUse: '只有在资料范围不清楚、需要先找候选文档、或 search 结果为空时使用。',
    preconditions: ['若 selectedDocumentIds 已固定且 search 已命中文档，通常不需要再 list_documents。'],
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
  executionMeta: KB_EXECUTION_META
})

export const KB_TOOL_DEFINITIONS = [
  KB_HYBRID_SEARCH_CHUNKS_CONTRACT,
  KB_VECTOR_SEARCH_CHUNKS_CONTRACT,
  KB_FTS_SEARCH_CHUNKS_CONTRACT,
  KB_LIST_DOCUMENTS_CONTRACT
] as const
