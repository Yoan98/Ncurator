import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { TOOL_RESULT_INLINE_MAX_CHARS } from '../../shared/toolResultPersistence'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'

const STRUCTURED_FILE_EXTENSION_PATTERN = /\.(?:doc|docx|ppt|pptx|pdf|xls|xlsx|odt|ods|odp)$/iu

// 单次 text_file_read 返回字符上限：略低于工具结果截断上限，为 JSON 包装与路径等开销留出余量，
// 保证按此上限分段读取的结果不会被 hand 层再次截断落盘。
export const TEXT_FILE_READ_MAX_CHARS = Math.floor(TOOL_RESULT_INLINE_MAX_CHARS * 0.9)

export const TEXT_FILE_SEARCH_MAX_MATCHES = 10
export const TEXT_FILE_SEARCH_CONTEXT_CHARS = 320
export const TEXT_FILE_SEARCH_MATCH_TEXT_MAX_CHARS = 160

const textFilePathSchema = z
  .string()
  .min(1)
  .refine((value) => !STRUCTURED_FILE_EXTENSION_PATTERN.test(value), {
    message: 'text_file 工具只支持 UTF-8 普通文本；DOCX、PPT/PPTX、PDF、XLS/XLSX 等结构化文档不支持'
  })
  .meta({
    'x-constraint':
      'text_file 工具只支持 UTF-8 普通文本；DOCX、PPT/PPTX、PDF、XLS/XLSX 等结构化文档不支持'
  })

const textFileSourcePathField = textFilePathSchema.describe('目标文本文件的绝对路径')

const textFileReadLinesSchema = z.object({
  type: z.literal('lines').describe('按行读取，适合多行文本'),
  sourcePath: textFileSourcePathField,
  startLine: z.number().int().min(1).optional().describe('1-based 起始行号，缺省从第 1 行开始'),
  lineCount: z.number().int().min(1).optional().describe('读取行数，缺省读至文件末尾')
})

const textFileReadCharsSchema = z.object({
  type: z.literal('chars').describe('按字符读取，适合单行超长内容（如工具结果截断日志）'),
  sourcePath: textFileSourcePathField,
  startOffset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('读取的起始字符位置（文件字符序列从 1 开始计数），缺省从文件开头开始'),
  charCount: z.number().int().min(1).optional().describe('读取字符数，缺省读至文件末尾')
})

export const TEXT_FILE_READ_SCHEMA = z.discriminatedUnion('type', [
  textFileReadLinesSchema,
  textFileReadCharsSchema
])

const fileEditSchema = z.object({
  oldText: z.string().min(1),
  newText: z.string()
})

export const TEXT_FILE_EDIT_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('create'),
    content: z.string()
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('rewrite'),
    content: z.string()
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('edit'),
    edits: z.array(fileEditSchema).min(1)
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('replaceAll'),
    oldText: z.string().min(1),
    newText: z.string()
  })
])

export const TEXT_FILE_READ_OUTPUT_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lines'),
    sourcePath: z.string(),
    content: z.string(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    totalLines: z.number().int().min(1)
  }),
  z.object({
    type: z.literal('chars'),
    sourcePath: z.string(),
    content: z.string(),
    startOffset: z.number().int().min(1),
    endOffset: z.number().int().min(1),
    totalChars: z.number().int().min(1)
  })
])

export const TEXT_FILE_SEARCH_SCHEMA = z
  .object({
    sourcePath: textFileSourcePathField,
    query: z.string().min(1).describe('要检索的文字或正则表达式'),
    mode: z.enum(['literal', 'regex']).optional().describe('检索模式，缺省为 literal')
  })
  .strict()

export const TEXT_FILE_SEARCH_OUTPUT_SCHEMA = z
  .object({
    sourcePath: z.string(),
    totalMatchCount: z.number().int().min(0),
    returnedMatchCount: z.number().int().min(0),
    matches: z
      .array(
        z
          .object({
            line: z.number().int().min(1),
            charOffset: z.number().int().min(1),
            matchText: z.string(),
            textContext: z.string(),
            truncated: z.boolean()
          })
          .strict()
      )
      .max(TEXT_FILE_SEARCH_MAX_MATCHES)
  })
  .strict()

export const TEXT_FILE_EDIT_OUTPUT_SCHEMA = z.string().min(1)

const fileResourceKey = (args: JsonObject): string | undefined => readStringArg(args, 'sourcePath')

export const TEXT_FILE_READ_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TEXT_FILE_READ_SCHEMA>,
  z.infer<typeof TEXT_FILE_READ_OUTPUT_SCHEMA>,
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
    description:
      '读取普通文本文件（UTF-8）并返回文本内容与起止范围，支持按行或按字符读。无法读取结构化文件如 docx、pptx、pdf、xlsx 等。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  })
}

export const TEXT_FILE_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TEXT_FILE_SEARCH_SCHEMA>,
  z.infer<typeof TEXT_FILE_SEARCH_OUTPUT_SCHEMA>,
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
    description:
      '在文本文件中按 literal 或 regex 检索，返回每个命中的行号、全文件字符偏移与命中附近文字。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: fileResourceKey
  })
}

export const TEXT_FILE_EDIT_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TEXT_FILE_EDIT_SCHEMA>,
  z.infer<typeof TEXT_FILE_EDIT_OUTPUT_SCHEMA>,
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
      'action=replaceAll：把已有文件中 oldText 的全部精确匹配替换为 newText。',
      '返回文件路径和实际修改数量，并记录可查看、可回退的文件修改。'
    ].join('\n')
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: fileResourceKey
  })
}

export const TEXT_FILE_TOOL_SPECS = [
  TEXT_FILE_READ_TOOL_SPEC,
  TEXT_FILE_SEARCH_TOOL_SPEC,
  TEXT_FILE_EDIT_TOOL_SPEC
] as const

export type FileReadInput = z.infer<typeof TEXT_FILE_READ_SCHEMA>
export type FileReadOutput = z.infer<typeof TEXT_FILE_READ_OUTPUT_SCHEMA>
export type FileSearchInput = z.infer<typeof TEXT_FILE_SEARCH_SCHEMA>
export type FileSearchOutput = z.infer<typeof TEXT_FILE_SEARCH_OUTPUT_SCHEMA>
export type FileEditInput = z.infer<typeof TEXT_FILE_EDIT_SCHEMA>
