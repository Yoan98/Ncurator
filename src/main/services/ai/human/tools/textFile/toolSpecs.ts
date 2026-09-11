import type { JsonObject } from '../../../../../../shared/types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  renderTextFileEditModelResult,
  renderTextFileReadModelResult,
  renderTextFileSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  TEXT_FILE_EDIT_SCHEMA,
  TEXT_FILE_READ_SCHEMA,
  TEXT_FILE_SEARCH_SCHEMA
} from './toolSchemas'

const fileResourceKey = (args: JsonObject): string | undefined => readStringArg(args, 'sourcePath')

export const TEXT_FILE_READ_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_READ_SCHEMA>,
  'text_file_read',
  'text-file'
> = {
  name: 'text_file_read',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_READ_SCHEMA,
  promptSpec: {
    name: 'text_file_read',
    description: '按行读取 UTF-8 普通文本。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  }),
  modelResult: {
    renderSuccess: renderTextFileReadModelResult
  }
}

export const TEXT_FILE_SEARCH_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_SEARCH_SCHEMA>,
  'text_file_search',
  'text-file'
> = {
  name: 'text_file_search',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_SEARCH_SCHEMA,
  promptSpec: {
    name: 'text_file_search',
    description: '在文本文件中按文字或正则搜索。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  }),
  modelResult: { renderSuccess: renderTextFileSearchModelResult }
}

export const TEXT_FILE_EDIT_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_EDIT_SCHEMA>,
  'text_file_edit',
  'text-file'
> = {
  name: 'text_file_edit',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_EDIT_SCHEMA,
  promptSpec: {
    name: 'text_file_edit',
    description: '创建或修改 UTF-8 普通文本文件。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: fileResourceKey
  }),
  modelResult: { renderSuccess: renderTextFileEditModelResult }
}

export const TEXT_FILE_TOOL_SPECS = [
  TEXT_FILE_READ_TOOL_SPEC,
  TEXT_FILE_SEARCH_TOOL_SPEC,
  TEXT_FILE_EDIT_TOOL_SPEC
] as const

export type {
  FileEditInput,
  FileEditOutput,
  FileReadInput,
  FileReadOutput,
  FileSearchInput,
  FileSearchOutput
} from './toolSchemas'

export {
  TEXT_FILE_READ_MAX_BYTES,
  TEXT_FILE_READ_MAX_LINE_CHARS,
  TEXT_FILE_READ_MAX_LINES,
  TEXT_FILE_SEARCH_CONTEXT_CHARS,
  TEXT_FILE_SEARCH_MATCH_TEXT_MAX_CHARS,
  TEXT_FILE_SEARCH_MAX_MATCHES
} from './toolSchemas'
