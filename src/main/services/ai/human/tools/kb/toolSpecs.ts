import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

const KB_SEARCH_EXAMPLE: JsonObject = {
  queryText: 'approval denied terminal artifact requirement',
  strategy: 'auto',
  limit: 3
}

const KB_LIST_DOCUMENTS_EXAMPLE: JsonObject = {
  query: 'weekly risk',
  page: 1,
  pageSize: 5
}

const KB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  parallelSafe: true,
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
  query: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  documentIds: z.array(z.string()).optional()
})

export const KB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_SEARCH_SCHEMA>,
  'kb_search',
  'kb-evidence-query'
> = {
  name: 'kb_search',
  familyId: 'kb',
  skillIds: ['kb-evidence-query'],
  requiresWorkspace: true,
  schema: KB_SEARCH_SCHEMA,
  promptSpec: {
    name: 'kb_search',
    purpose: '在当前工作区知识库中统一执行内容搜索；默认 auto 会走最合适的检索策略。',
    whenToUse: '当任务需要在 KB 中找事实、证据、规则、说明或引用时使用。',
    preconditions: ['queryText 不能为空。', '默认搜索范围是当前工作区知识库。'],
    returns: [
      {
        name: 'rows',
        type: 'Array<chunk result>',
        description: '命中的知识片段列表。'
      }
    ],
    examples: [
      {
        goal: '在当前工作区知识库中检索 approval denied 相关规范',
        args: KB_SEARCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

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
    whenToUse: '当需要先缩小候选文档范围、提高定位精度、或 search 结果过散时使用。',
    preconditions: ['若已选资料和命中 chunk 已经足够，通常不需要再 list_documents。'],
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

export const KB_TOOL_SPECS = [KB_SEARCH_TOOL_SPEC, KB_LIST_DOCUMENTS_TOOL_SPEC] as const
