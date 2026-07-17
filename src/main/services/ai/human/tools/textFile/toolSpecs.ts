import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'

const STRUCTURED_FILE_EXTENSION_PATTERN = /\.(?:doc|docx|ppt|pptx|pdf|xls|xlsx|odt|ods|odp)$/iu

const textFilePathSchema = z
  .string()
  .min(1)
  .refine((value) => !STRUCTURED_FILE_EXTENSION_PATTERN.test(value), {
    message:
      'text_file tools only support UTF-8 plain text; DOCX, PPT/PPTX, PDF, XLS/XLSX and other structured documents are not supported'
  })

export const TEXT_FILE_READ_SCHEMA = z.object({
  sourcePath: textFilePathSchema,
  startLine: z.number().int().min(1).optional(),
  lineCount: z.number().int().min(1).optional()
})

const fileEditSchema = z.object({
  oldText: z.string().min(1),
  newText: z.string()
})

export const TEXT_FILE_EDIT_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    sourcePath: textFilePathSchema,
    action: z.literal('create'),
    content: z.string()
  }),
  z.object({
    sourcePath: textFilePathSchema,
    action: z.literal('rewrite'),
    content: z.string()
  }),
  z.object({
    sourcePath: textFilePathSchema,
    action: z.literal('edit'),
    edits: z.array(fileEditSchema).min(1)
  }),
  z.object({
    sourcePath: textFilePathSchema,
    action: z.literal('replaceAll'),
    oldText: z.string().min(1),
    newText: z.string()
  })
])

export const TEXT_FILE_READ_OUTPUT_SCHEMA = z.object({
  sourcePath: z.string(),
  content: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  totalLines: z.number().int().min(1)
})

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
  requiresWorkspace: true,
  inputSchema: TEXT_FILE_READ_SCHEMA,
  outputSchema: TEXT_FILE_READ_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'text_file_read',
    description:
      '读取普通文本文件并支持指定行范围，并返回文本内容、实际起止行和文件总行数。如，txt，md，csv，json，代码 等 UTF-8 普通文本文件。无法读取结构化文件如 docx、pptx、pdf、xlsx 等。'
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
  requiresWorkspace: true,
  inputSchema: TEXT_FILE_EDIT_SCHEMA,
  outputSchema: TEXT_FILE_EDIT_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'text_file_edit',
    description: [
      '创建或修改普通文本文件,如 txt、md、csv、json，代码等 UTF-8 普通文本文件。',
      '无法创建或修改结构化文件如 docx、pptx、pdf、xlsx 等。',
      '每次调用执行一个 action。',
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

export const TEXT_FILE_TOOL_SPECS = [TEXT_FILE_READ_TOOL_SPEC, TEXT_FILE_EDIT_TOOL_SPEC] as const

export type FileReadInput = z.infer<typeof TEXT_FILE_READ_SCHEMA>
export type FileReadOutput = z.infer<typeof TEXT_FILE_READ_OUTPUT_SCHEMA>
export type FileEditInput = z.infer<typeof TEXT_FILE_EDIT_SCHEMA>
