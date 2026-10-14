import { z } from 'zod/v4'
import type { TextFileEditOutput,TextFileReadOutput,TextFileSearchOutput } from './outputTypes'

const STRUCTURED_FILE_EXTENSION_PATTERN = /\.(?:doc|docx|ppt|pptx|pdf|xls|xlsx|odt|ods|odp)$/iu

export const TEXT_FILE_READ_MAX_LINES = 2_000
export const TEXT_FILE_READ_MAX_BYTES = 51_200
export const TEXT_FILE_READ_MAX_LINE_CHARS = 2_000

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
  .describe('UTF-8 普通文本文件本机绝对路径；不支持 docx、pptx、pdf、xlsx 等结构化文件')

const textFileSourcePathField = textFilePathSchema

export const TEXT_FILE_READ_SCHEMA = z.object({
  sourcePath: textFileSourcePathField,
  startLine: z.number().int().min(1).optional().describe('1-based 起始行号，缺省从第 1 行开始'),
  lineCount: z
    .number()
    .int()
    .min(1)
    .max(TEXT_FILE_READ_MAX_LINES)
    .optional()
    .describe(`读取行数，缺省及最大为 ${TEXT_FILE_READ_MAX_LINES} 行`)
})

const fileEditItemSchema = z
  .object({
    oldText: z.string().min(1).describe('被替换的原文片段'),
    newText: z.string().describe('替换后的文字')
  })
  .strict()

export const TEXT_FILE_EDIT_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('create').describe('新建文件'),
    content: z.string().describe('完整文件内容')
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('rewrite').describe('完整改写已有文件'),
    content: z.string().describe('完整文件内容')
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('edit').describe('批量文本替换'),
    edits: z.array(fileEditItemSchema).min(1).describe('替换项列表')
  }),
  z.object({
    sourcePath: textFileSourcePathField,
    action: z.literal('replaceAll').describe('全文替换所有匹配'),
    oldText: z.string().min(1).describe('被替换的原文片段'),
    newText: z.string().describe('替换后的文字')
  })
])

export const TEXT_FILE_SEARCH_SCHEMA = z
  .object({
    sourcePath: textFileSourcePathField,
    query: z.string().min(1).describe('要检索的文字或正则表达式'),
    mode: z.enum(['literal', 'regex']).optional().describe('literal 或 regex，缺省 literal')
  })
  .strict()

export type FileReadInput = z.infer<typeof TEXT_FILE_READ_SCHEMA>
export type FileEditInput = z.infer<typeof TEXT_FILE_EDIT_SCHEMA>
export type FileSearchInput = z.infer<typeof TEXT_FILE_SEARCH_SCHEMA>

export type FileReadOutput = TextFileReadOutput
export type FileEditOutput = TextFileEditOutput
export type FileSearchOutput = TextFileSearchOutput

export type { TextFileEditOutput, TextFileReadOutput, TextFileSearchOutput } from './outputTypes'
