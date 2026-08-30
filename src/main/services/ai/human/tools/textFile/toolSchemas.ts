import { z } from 'zod/v4'

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

const textFileSourcePathField = textFilePathSchema.describe('目标文本文件的绝对路径')

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

export const TEXT_FILE_READ_OUTPUT_SCHEMA = z
  .object({
    content: z.string(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    totalLines: z.number().int().min(1),
    nextStartLine: z.number().int().min(1).optional()
  })
  .strict()

export const TEXT_FILE_SEARCH_SCHEMA = z
  .object({
    sourcePath: textFileSourcePathField,
    query: z.string().min(1).describe('要检索的文字或正则表达式'),
    mode: z.enum(['literal', 'regex']).optional().describe('检索模式，缺省为 literal')
  })
  .strict()

export const TEXT_FILE_SEARCH_OUTPUT_SCHEMA = z
  .object({
    totalMatchCount: z.number().int().min(0),
    returnedMatchCount: z.number().int().min(0),
    matches: z
      .array(
        z
          .object({
            line: z.number().int().min(1),
            matchText: z.string(),
            textContext: z.string(),
            truncated: z.boolean()
          })
          .strict()
      )
      .max(TEXT_FILE_SEARCH_MAX_MATCHES)
  })
  .strict()

export const TEXT_FILE_EDIT_OUTPUT_SCHEMA = z.object({}).strict()

export type FileReadInput = z.infer<typeof TEXT_FILE_READ_SCHEMA>
export type FileReadOutput = z.infer<typeof TEXT_FILE_READ_OUTPUT_SCHEMA>
export type FileSearchInput = z.infer<typeof TEXT_FILE_SEARCH_SCHEMA>
export type FileSearchOutput = z.infer<typeof TEXT_FILE_SEARCH_OUTPUT_SCHEMA>
export type FileEditInput = z.infer<typeof TEXT_FILE_EDIT_SCHEMA>
