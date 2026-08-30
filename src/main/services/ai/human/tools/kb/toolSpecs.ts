import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderKbListDocumentsModelResult,
  renderKbSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  KB_LIST_DOCUMENTS_SCHEMA,
  KB_SEARCH_SCHEMA
} from './toolSchemas'

const KB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'local-kb'
})

export const KB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_SEARCH_SCHEMA>,
  'kb_search',
  'kb-retrieval'
> = {
  name: 'kb_search',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  inputSchema: KB_SEARCH_SCHEMA,
  promptSpec: {
    name: 'kb_search',
    description: '检索工作区知识库中的相关内容片段。'
  },
  resolveExecutionMeta: KB_EXECUTION_META,
  modelResult: {
    renderSuccess: renderKbSearchModelResult
  }
}

export const KB_LIST_DOCUMENTS_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof KB_LIST_DOCUMENTS_SCHEMA>,
  'kb_list_documents',
  'kb-retrieval'
> = {
  name: 'kb_list_documents',
  familyId: 'kb',
  skillIds: ['kb-retrieval'],
  inputSchema: KB_LIST_DOCUMENTS_SCHEMA,
  promptSpec: {
    name: 'kb_list_documents',
    description: '列出工作区知识库中已索引的文档。'
  },
  resolveExecutionMeta: KB_EXECUTION_META,
  modelResult: {
    renderSuccess: renderKbListDocumentsModelResult
  }
}

export const KB_TOOL_SPECS = [KB_SEARCH_TOOL_SPEC, KB_LIST_DOCUMENTS_TOOL_SPEC] as const
