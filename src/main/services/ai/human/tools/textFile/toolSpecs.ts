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
  'file_read',
  'text-file'
> = {
  name: 'file_read',
  familyId: 'text-file',
  toolsetIds: ['text-file'],
  inputSchema: TEXT_FILE_READ_SCHEMA,
  promptSpec: {
    name: 'file_read',
    description: '读取代码、配置、Markdown、TXT 等 UTF-8 文本文件，按行返回内容并支持续读。'
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
  'file_search',
  'text-file'
> = {
  name: 'file_search',
  familyId: 'text-file',
  toolsetIds: ['text-file'],
  inputSchema: TEXT_FILE_SEARCH_SCHEMA,
  promptSpec: {
    name: 'file_search',
    description: '在代码、配置、Markdown、TXT 等 UTF-8 文本文件中按文字或正则搜索。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  }),
  modelResult: { renderSuccess: renderTextFileSearchModelResult }
}

export const TEXT_FILE_EDIT_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_EDIT_SCHEMA>,
  'file_edit',
  'text-file'
> = {
  name: 'file_edit',
  familyId: 'text-file',
  toolsetIds: ['text-file'],
  inputSchema: TEXT_FILE_EDIT_SCHEMA,
  promptSpec: {
    name: 'file_edit',
    description:
      '创建或修改代码、配置、Markdown、TXT 等 UTF-8 文本文件；支持新建、整体改写、精确替换和全文替换。'
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
