import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxCommentsRevisionsSchema,
  docxContentEditSchema,
  docxFormatSchema,
  docxMediaEditSchema,
  docxOutlineSchema,
  docxReadNodesSchema,
  docxReadVisualsSchema,
  docxSearchSchema,
  docxTableEditSchema
} from './schemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  docxMutationOutputSchema,
  docxOutlineOutputSchema,
  docxReadOutputSchema,
  docxReadVisualsOutputSchema,
  docxSearchOutputSchema
} from './outputSchemas'

const readMeta = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'docx'
})

const writeMeta = createStaticExecutionMetaResolver({
  mutability: 'mutating',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'docx'
})

type DocxToolSpec<
  TArgs extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TName extends RuntimeToolName = RuntimeToolName,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId> & { activityActionType: string }

export const DOCX_READ_OUTLINE_TOOL_SPEC = {
  name: 'docx_read_outline',
  familyId: 'docx',
  skillIds: ['docx-read', 'docx-write'],
  inputSchema: docxOutlineSchema,
  outputSchema: docxOutlineOutputSchema,
  promptSpec: {
    name: 'docx_read_outline',
    description:
      '按逻辑分页返回 Word 文档的轻量顺序和结构摘要；逻辑页不代表 Word 排版页面。返回临时 nodeIndex 与稳定 nodeId。'
  },
  resolveExecutionMeta: readMeta,
  activityActionType: 'docx_read_outline'
} satisfies DocxToolSpec<
  z.infer<typeof docxOutlineSchema>,
  z.infer<typeof docxOutlineOutputSchema>,
  'docx_read_outline',
  'docx-read' | 'docx-write'
>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  skillIds: ['docx-read', 'docx-write'],
  inputSchema: docxSearchSchema,
  outputSchema: docxSearchOutputSchema,
  promptSpec: {
    name: 'docx_search',
    description:
      '在 Word 文档中按 literal、regex 或 semantic 检索文字，返回可直接交给读取和写入工具的 nodeId。'
  },
  resolveExecutionMeta: readMeta,
  activityActionType: 'docx_search'
} satisfies DocxToolSpec<
  z.infer<typeof docxSearchSchema>,
  z.infer<typeof docxSearchOutputSchema>,
  'docx_search',
  'docx-read' | 'docx-write'
>

export const DOCX_READ_NODES_TOOL_SPEC = {
  name: 'docx_read_nodes',
  familyId: 'docx',
  skillIds: ['docx-read', 'docx-write'],
  inputSchema: docxReadNodesSchema,
  outputSchema: docxReadOutputSchema,
  promptSpec: {
    name: 'docx_read_nodes',
    description: '读取指定 Word 节点的递归语义树；一次最多读取 20 个 nodeId 或连续 50 个根节点。'
  },
  resolveExecutionMeta: readMeta,
  activityActionType: 'docx_read_nodes'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadNodesSchema>,
  z.infer<typeof docxReadOutputSchema>,
  'docx_read_nodes',
  'docx-read' | 'docx-write'
>

export const DOCX_READ_VISUALS_TOOL_SPEC = {
  name: 'docx_read_visuals',
  familyId: 'docx',
  skillIds: ['docx-read', 'docx-write'],
  inputSchema: docxReadVisualsSchema,
  outputSchema: docxReadVisualsOutputSchema,
  promptSpec: {
    name: 'docx_read_visuals',
    description:
      '按 visualId 读取 DOCX 图片、图表等视觉内容并返回识别文本；一次支持 1 至 10 项；不支持 .doc。'
  },
  resolveExecutionMeta: readMeta,
  activityActionType: 'docx_read_visuals'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadVisualsSchema>,
  z.infer<typeof docxReadVisualsOutputSchema>,
  'docx_read_visuals',
  'docx-read' | 'docx-write'
>

const defineWriteSpec = <TName extends RuntimeToolName, TSchema extends z.ZodType>(input: {
  name: TName
  schema: TSchema
  description: string
}) => ({
  name: input.name,
  familyId: 'docx' as const,
  skillIds: ['docx-write'] as RuntimeSkillId[],
  inputSchema: input.schema,
  outputSchema: docxMutationOutputSchema,
  promptSpec: { name: input.name, description: input.description },
  resolveExecutionMeta: writeMeta,
  activityActionType: input.name
})

export const DOCX_CONTENT_EDIT_TOOL_SPEC = defineWriteSpec({
  name: 'docx_content_edit',
  schema: docxContentEditSchema,
  description:
    '创建 DOCX 或局部修改普通内容节点。一次只执行 replace_text、insert_nodes、replace_node、delete_node、move_node 之一；不负责格式、表格结构、媒体、批注或修订。'
})

export const DOCX_FORMAT_TOOL_SPEC = defineWriteSpec({
  name: 'docx_format',
  schema: docxFormatSchema,
  description:
    '原子修改一个或多个 DOCX 节点的文字、段落、表格、行、单元格、section、命名样式或编号；同一局部 operation 对所有目标应用同一格式 patch。省略的格式字段保持不变；update_named_style 会影响所有引用该样式的节点。'
})

export const DOCX_TABLE_EDIT_TOOL_SPEC = defineWriteSpec({
  name: 'docx_table_edit',
  schema: docxTableEditSchema,
  description:
    '创建、删除或修改 DOCX 表格结构，包括行列增删和单元格合并拆分；单元格文字用 docx_content_edit，外观用 docx_format。'
})

export const DOCX_MEDIA_EDIT_TOOL_SPEC = defineWriteSpec({
  name: 'docx_media_edit',
  schema: docxMediaEditSchema,
  description:
    '插入、替换、删除或修改 DOCX 图片等视觉对象，负责媒体文件、relationship、尺寸和替代文字。'
})

export const DOCX_COMMENTS_REVISIONS_TOOL_SPEC = defineWriteSpec({
  name: 'docx_comments_revisions',
  schema: docxCommentsRevisionsSchema,
  description:
    '新增、修改、回复或删除 Word 批注，切换修订模式，以及接受或拒绝 Word 修订；这不是文档读取检查工具。'
})

export const DOCX_READ_TOOL_SPECS = [
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_NODES_TOOL_SPEC,
  DOCX_READ_VISUALS_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [
  DOCX_CONTENT_EDIT_TOOL_SPEC,
  DOCX_FORMAT_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_MEDIA_EDIT_TOOL_SPEC,
  DOCX_COMMENTS_REVISIONS_TOOL_SPEC
] as const

export const DOCX_TOOL_SPECS = [...DOCX_READ_TOOL_SPECS, ...DOCX_WRITE_TOOL_SPECS] as const
