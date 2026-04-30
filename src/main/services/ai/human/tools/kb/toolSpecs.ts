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
  sourceNameQuery: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  documentIds: z.array(z.string()).optional()
})

export const KB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_SEARCH_SCHEMA>,
  'kb_search',
  'kb-retrieval'
> = {
  name: 'kb_search',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  requiresWorkspace: true,
  schema: KB_SEARCH_SCHEMA,
  promptSpec: {
    name: 'kb_search',
    description:
      '在当前用户工作区知识库中按查询词或语句检索相关内容片段，并返回命中证据及其来源文档。',
    whenToUse: '当需要按关键词或语义语句查找用户工作区知识库中相关内容片段时使用。',
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
  'kb-retrieval'
> = {
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  requiresWorkspace: true,
  schema: KB_LIST_DOCUMENTS_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    description:
      '查询当前工作区知识库中已建立了索引的文档列表；可选按文档名做包含过滤。',
    whenToUse:
      '当需要先查看当前工作区里有哪些文档已经进入知识库，或需要按文档名缩小候选范围时使用。',
    examples: [
      {
        goal: '先列出当前工作区中已经可被知识库检索的文档',
        args: KB_LIST_DOCUMENTS_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: KB_EXECUTION_META
}

export const KB_TOOL_SPECS = [KB_SEARCH_TOOL_SPEC, KB_LIST_DOCUMENTS_TOOL_SPEC] as const
