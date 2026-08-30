import type { JsonObject } from '../../../../../../shared/types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  renderTextFileEditModelResult,
  renderTextFileReadModelResult,
  renderTextFileSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  TEXT_FILE_EDIT_OUTPUT_SCHEMA,
  TEXT_FILE_EDIT_SCHEMA,
  TEXT_FILE_READ_OUTPUT_SCHEMA,
  TEXT_FILE_READ_SCHEMA,
  TEXT_FILE_READ_MAX_BYTES,
  TEXT_FILE_READ_MAX_LINE_CHARS,
  TEXT_FILE_READ_MAX_LINES,
  TEXT_FILE_SEARCH_OUTPUT_SCHEMA,
  TEXT_FILE_SEARCH_SCHEMA
} from './toolSchemas'

const fileResourceKey = (args: JsonObject): string | undefined => readStringArg(args, 'sourcePath')

export const TEXT_FILE_READ_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_READ_SCHEMA>,
  import('zod/v4').infer<typeof TEXT_FILE_READ_OUTPUT_SCHEMA>,
  'text_file_read',
  'text-file'
> = {
  name: 'text_file_read',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_READ_SCHEMA,
  outputSchema: TEXT_FILE_READ_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'text_file_read',
    description: `按行读取 UTF-8 普通文本并返回带续读位置的内容窗口；缺省和单次最多 ${TEXT_FILE_READ_MAX_LINES} 行、约 ${TEXT_FILE_READ_MAX_BYTES} bytes，单行最多展示 ${TEXT_FILE_READ_MAX_LINE_CHARS} 字符。无法读取 docx、pptx、pdf、xlsx 等结构化文件。`
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
  import('zod/v4').infer<typeof TEXT_FILE_SEARCH_OUTPUT_SCHEMA>,
  'text_file_search',
  'text-file'
> = {
  name: 'text_file_search',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_SEARCH_SCHEMA,
  outputSchema: TEXT_FILE_SEARCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'text_file_search',
    description: '在文本文件中按 literal 或 regex 检索，返回每个命中的行号与命中附近文字。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  }),
  modelResult: { renderSuccess: renderTextFileSearchModelResult }
}

export const TEXT_FILE_EDIT_TOOL_SPEC: HumanToolSpec<
  import('zod/v4').infer<typeof TEXT_FILE_EDIT_SCHEMA>,
  import('zod/v4').infer<typeof TEXT_FILE_EDIT_OUTPUT_SCHEMA>,
  'text_file_edit',
  'text-file'
> = {
  name: 'text_file_edit',
  familyId: 'text-file',
  skillIds: ['text-file'],
  inputSchema: TEXT_FILE_EDIT_SCHEMA,
  outputSchema: TEXT_FILE_EDIT_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'text_file_edit',
    description: [
      '创建或修改普通文本文件,如 txt、md、csv、json，代码等 UTF-8 普通文本文件。',
      '无法创建或修改结构化文件如 docx、pptx、pdf、xlsx 等。',
      'action=create：创建新文件并写入完整内容，不覆盖已有文件。',
      'action=rewrite：使用新内容完整改写已有文件。',
      'action=edit：对已有文件执行一个或多个精确文本修改；每个 oldText 必须恰好匹配一次。',
      'action=replaceAll：把已有文件中 oldText 的全部精确匹配替换为 newText。'
    ].join('\n')
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
