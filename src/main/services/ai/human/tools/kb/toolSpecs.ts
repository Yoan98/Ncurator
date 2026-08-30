import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderKbListDocumentsModelResult,
  renderKbSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  KB_LIST_DOCUMENTS_OUTPUT_SCHEMA,
  KB_LIST_DOCUMENTS_SCHEMA,
  KB_SEARCH_OUTPUT_SCHEMA,
  KB_SEARCH_SCHEMA
} from './toolSchemas'

const KB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'local-kb'
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
  inputSchema: KB_SEARCH_SCHEMA,
  outputSchema: KB_SEARCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'kb_search',
    description:
      '在用户工作区域知识库中按查询词或语义语句检索内容片段，并返回命中证据、来源文档与内容块信息。'
  },
  resolveExecutionMeta: KB_EXECUTION_META,
  modelResult: {
    renderSuccess: renderKbSearchModelResult
  }
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
  inputSchema: KB_LIST_DOCUMENTS_SCHEMA,
  outputSchema: KB_LIST_DOCUMENTS_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    description:
      '查询用户工作区域知识库中已建立索引的文档并支持按文档名过滤，并返回可检索文档的分页列表。'
  },
  resolveExecutionMeta: KB_EXECUTION_META,
  modelResult: {
    renderSuccess: renderKbListDocumentsModelResult
  }
}

export const KB_TOOL_SPECS = [KB_SEARCH_TOOL_SPEC, KB_LIST_DOCUMENTS_TOOL_SPEC] as const
