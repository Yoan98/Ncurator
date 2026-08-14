import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxEditSchema,
  docxOutlineRequestSchema,
  docxReadRequestSchema,
  docxReadVisualsSchema,
  docxSearchRequestSchema
} from './schemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  docxOutlineOutputSchema,
  docxReadBlocksOutputSchema,
  docxReadVisualsOutputSchema,
  docxSearchOutputSchema,
  docxWriteOutputSchema
} from './outputSchemas'

const createDocxReadExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

const createDocxMutatingExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

type DocxToolSpec<
  TArgs extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TName extends RuntimeToolName = RuntimeToolName,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId> & {
  activityActionType?: string
}

export const DOCX_READ_OUTLINE_TOOL_SPEC = {
  name: 'docx_read_outline',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxOutlineRequestSchema,
  outputSchema: docxOutlineOutputSchema,
  promptSpec: {
    name: 'docx_read_outline',
    description:
      '按 percent 或 blockIndex 范围读取 .docx、.doc 文档的块级 outline，并返回块文本、定位信息和结构类型。'
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_outline'
} satisfies DocxToolSpec<
  z.infer<typeof docxOutlineRequestSchema>,
  z.infer<typeof docxOutlineOutputSchema>,
  'docx_read_outline',
  'docx-read'
>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxSearchRequestSchema,
  outputSchema: docxSearchOutputSchema,
  promptSpec: {
    name: 'docx_search',
    description:
      '在 .docx、.doc 文档中按 literal、regex 或 semantic 模式检索块级文本，并返回匹配文本、位置和相关性信息。'
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_search'
} satisfies DocxToolSpec<
  z.infer<typeof docxSearchRequestSchema>,
  z.infer<typeof docxSearchOutputSchema>,
  'docx_search',
  'docx-read'
>

export const DOCX_READ_TOOL_SPEC = {
  name: 'docx_read_blocks',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxReadRequestSchema,
  outputSchema: docxReadBlocksOutputSchema,
  promptSpec: {
    name: 'docx_read_blocks',
    description:
      '按 blockId 集合或 blockIndex 闭区间读取 .docx、.doc 文档的递归语义树，保留段落、行内节点、表格层级和视觉节点的原始归属顺序。'
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_blocks'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadRequestSchema>,
  z.infer<typeof docxReadBlocksOutputSchema>,
  'docx_read_blocks',
  'docx-read'
>

export const DOCX_READ_VISUALS_TOOL_SPEC = {
  name: 'docx_read_visuals',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxReadVisualsSchema,
  outputSchema: docxReadVisualsOutputSchema,
  promptSpec: {
    name: 'docx_read_visuals',
    description:
      '按 visualId 读取 DOCX 中的视觉内容并返回识别文本。一次支持 1 至 10 项；每项独立返回结果或错误；不支持 .doc。'
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_visuals'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadVisualsSchema>,
  z.infer<typeof docxReadVisualsOutputSchema>,
  'docx_read_visuals',
  'docx-read'
>

export const DOCX_EDIT_TOOL_SPEC = {
  name: 'docx_edit',
  familyId: 'docx',
  skillIds: ['docx-write'],
  inputSchema: docxEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_edit',
    description:
      '创建或编辑 DOCX 文件，支持递归内容树、文本替换、节点样式、表格更新和删除。可能删除视觉内容的操作必须明确允许 visual loss；参数无效时不修改文件。不支持 .doc 写入。'
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_edit',
  'docx-write'
>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC,
  DOCX_READ_VISUALS_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [DOCX_EDIT_TOOL_SPEC] as const

export const DOCX_TOOL_SPECS = [...DOCX_READ_TOOL_SPECS, ...DOCX_WRITE_TOOL_SPECS] as const

export type AnyDocxToolSpec = (typeof DOCX_TOOL_SPECS)[number]
export type DocxToolName = AnyDocxToolSpec['name']

const DOCX_TOOL_SPEC_BY_NAME = new Map<DocxToolName, AnyDocxToolSpec>(
  DOCX_TOOL_SPECS.map((spec) => [spec.name, spec])
)

export function getDocxToolSpec<TName extends DocxToolName>(
  name: TName
): Extract<AnyDocxToolSpec, { name: TName }> {
  const spec = DOCX_TOOL_SPEC_BY_NAME.get(name)
  if (!spec) {
    throw new Error(`missing docx tool spec for ${name}`)
  }
  return spec as Extract<AnyDocxToolSpec, { name: TName }>
}
