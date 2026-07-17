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
      '能力：读取 UTF-8 普通文本文件，可通过 startLine 和 lineCount 指定行范围。\n结果：返回文本内容、实际起止行和文件总行数。\n边界：startLine 从 1 开始；不支持目录、无效 UTF-8 文件，以及 DOCX、PPT/PPTX、PDF、XLS/XLSX 等结构化或二进制文件。',
    whenToUse: '适用于需要获取 Markdown、TXT、配置或代码文件文本内容的任务。',
    examples: [
      {
        goal: '读取配置文件前 200 行',
        args: {
          sourcePath: 'src/config.ts',
          startLine: 1,
          lineCount: 200
        }
      }
    ]
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
      '能力：创建或修改 UTF-8 普通文本文件。每次调用执行一个 action。',
      'action=create：创建新文件并写入完整内容，不覆盖已有文件。',
      'action=rewrite：使用新内容完整改写已有文件。',
      'action=edit：对已有文件执行一个或多个精确文本修改；每个 oldText 必须恰好匹配一次。',
      'action=replaceAll：把已有文件中 oldText 的全部精确匹配替换为 newText。',
      '结果：返回文件路径和实际修改数量，并记录可查看、可回退的文件修改。',
      '边界：只处理 UTF-8 普通文本，不支持 DOCX、PPT/PPTX、PDF、XLS/XLSX 等结构化或二进制文件；rewrite、edit 和 replaceAll 要求文件已存在；edit 的多项修改不能重叠；replaceAll 必须至少匹配一次；修改已有文件时保留原有 BOM、换行风格和文件权限；任一校验或写入失败都不会保留部分修改。'
    ].join('\n'),
    whenToUse: '适用于需要创建、完整改写或精确修改普通文本文件的任务。',
    examples: [
      {
        goal: '创建一份待办文档',
        args: {
          sourcePath: 'notes/todo.md',
          action: 'create',
          content: '# Todo\n\n- 完成方案'
        }
      },
      {
        goal: '完整改写待办文档',
        args: {
          sourcePath: 'notes/todo.md',
          action: 'rewrite',
          content: '# Todo\n\n暂无任务'
        }
      },
      {
        goal: '精确修改两个配置项',
        args: {
          sourcePath: 'src/config.ts',
          action: 'edit',
          edits: [
            { oldText: 'const timeout = 1000', newText: 'const timeout = 3000' },
            { oldText: 'const retries = 1', newText: 'const retries = 3' }
          ]
        }
      },
      {
        goal: '替换代码中全部旧常量名',
        args: {
          sourcePath: 'src/config.ts',
          action: 'replaceAll',
          oldText: 'OLD_API_URL',
          newText: 'API_BASE_URL'
        }
      }
    ]
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
