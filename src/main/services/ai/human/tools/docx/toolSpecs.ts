import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxEditSchema,
  docxOutlineRequestSchema,
  docxReadRequestSchema,
  docxSearchRequestSchema
} from './schemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  docxOutlineOutputSchema,
  docxReadBlocksOutputSchema,
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
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId> & {
  activityActionType?: string
}

export const DOCX_READ_OUTLINE_TOOL_SPEC = {
  name: 'docx_read_outline',
  familyId: 'docx',
  requiresWorkspace: true,
  skillIds: ['docx-read'],
  inputSchema: docxOutlineRequestSchema,
  outputSchema: docxOutlineOutputSchema,
  promptSpec: {
    name: 'docx_read_outline',
    description:
      '按 percent 或 blockIndex 范围读取 docx 的块级 outline，并返回块文本、定位信息和结构类型。'
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
  requiresWorkspace: true,
  skillIds: ['docx-read'],
  inputSchema: docxSearchRequestSchema,
  outputSchema: docxSearchOutputSchema,
  promptSpec: {
    name: 'docx_search',
    description:
      '在 docx 中按 literal、regex 或 semantic 模式检索块级文本，并返回匹配文本、位置和相关性信息。'
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
  requiresWorkspace: true,
  skillIds: ['docx-read'],
  inputSchema: docxReadRequestSchema,
  outputSchema: docxReadBlocksOutputSchema,
  promptSpec: {
    name: 'docx_read_blocks',
    description:
      '按 blockId 集合或 blockIndex 闭区间读取 docx 的详细块内容，并返回段落 runs、表格单元格和单元格段落信息。'
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_blocks'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadRequestSchema>,
  z.infer<typeof docxReadBlocksOutputSchema>,
  'docx_read_blocks',
  'docx-read'
>

export const DOCX_EDIT_TOOL_SPEC = {
  name: 'docx_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  skillIds: ['docx-write'],
  inputSchema: docxEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_edit',
    description: [
      '创建或修改 docx 内容。一次 docx_edit 调用接收 actions 数组，并严格按数组顺序串行执行；全部 action 成功后才形成一次写入结果。',
      'action type=create_document：新建 docx，并可一次写入 heading、paragraph、table；必须作为唯一 action。',
      'action type=insert_blocks：在真实 anchorBlockId 前/后插入多个 block，按输入 blocks 顺序写入。',
      'action type=replace_block：把一个完整 block 替换成新的 heading、paragraph 或 table。',
      'action type=replace_text：在全文或指定 blockIds 中替换文本。',
      'action type=style_text：给指定 block 内命中的文本设置加粗、斜体、下划线、颜色等样式。',
      'action type=update_table_cell：替换指定表格单元格的文本。',
      'action type=delete_blocks：删除一个或多个完整 block。',
      '返回写入后的编辑状态，以及所有 action 完成后的相邻区域详细回读信息（postWriteReadback字段），它代表着修改后最新的 docx 内容结构。'
    ].join('\n')
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
  DOCX_READ_TOOL_SPEC
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
