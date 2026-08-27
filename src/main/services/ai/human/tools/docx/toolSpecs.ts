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
import {
  renderDocxContentEditModelResult,
  renderDocxOutlineModelResult,
  renderDocxReadNodesModelResult,
  renderDocxSearchModelResult
} from '../../shared/modelToolResultRenderers'
import { createRetryModelResultPolicy } from '../modelResultPolicies'

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
  skillIds: ['docx-read'],
  inputSchema: docxOutlineSchema,
  outputSchema: docxOutlineOutputSchema,
  promptSpec: {
    name: 'docx_read_outline',
    description:
      '读取 Word 文档的逻辑结构，按逻辑页返回自适应 segment map、结构锚点、关键词和原文代表句；结果不包含完整正文，逻辑页不代表 Word 排版页面。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxOutlineModelResult,
    overflowPolicy: createRetryModelResultPolicy(
      'Call docx_read_outline again with a smaller pageCount.'
    )
  },
  activityActionType: 'docx_read_outline'
} satisfies DocxToolSpec<
  z.infer<typeof docxOutlineSchema>,
  z.infer<typeof docxOutlineOutputSchema>,
  'docx_read_outline',
  'docx-read'
>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxSearchSchema,
  outputSchema: docxSearchOutputSchema,
  promptSpec: {
    name: 'docx_search',
    description:
      '在 Word 完整原文中按 literal 或 regex 检索；结果包含实际命中的稳定 nodeId、命中片段，并可附带同一 story 的前后节点预览，不包含完整文档正文。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxSearchModelResult,
    overflowPolicy: createRetryModelResultPolicy(
      'Call docx_search again with includeContext=false, narrower nodeIds, or a more specific query.'
    )
  },
  activityActionType: 'docx_search'
} satisfies DocxToolSpec<
  z.infer<typeof docxSearchSchema>,
  z.infer<typeof docxSearchOutputSchema>,
  'docx_search',
  'docx-read'
>

export const DOCX_READ_NODES_TOOL_SPEC = {
  name: 'docx_read_nodes',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxReadNodesSchema,
  outputSchema: docxReadOutputSchema,
  promptSpec: {
    name: 'docx_read_nodes',
    description:
      '返回指定 Word 节点或连续范围的递归语义内容，只包含所选范围；一次最多读取 20 个 nodeId 或连续 50 个根节点。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxReadNodesModelResult,
    overflowPolicy: createRetryModelResultPolicy(
      'Call docx_read_nodes again with fewer nodeIds or a smaller fromNodeIndex/toNodeIndex range.'
    )
  },
  activityActionType: 'docx_read_nodes'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadNodesSchema>,
  z.infer<typeof docxReadOutputSchema>,
  'docx_read_nodes',
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
      '按 visualId 读取 DOCX 图片、图表等视觉内容并返回识别文本；一次支持 1 至 10 项；不支持 .doc。'
  },
  resolveExecutionMeta: readMeta,
  activityActionType: 'docx_read_visuals'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadVisualsSchema>,
  z.infer<typeof docxReadVisualsOutputSchema>,
  'docx_read_visuals',
  'docx-read'
>

const defineMutationSpec = <
  TName extends RuntimeToolName,
  TSchema extends z.ZodType,
  TSkillId extends RuntimeSkillId
>(input: {
  name: TName
  skillId: TSkillId
  schema: TSchema
  description: string
  modelResult?: HumanToolSpec['modelResult']
}) => ({
  name: input.name,
  familyId: 'docx' as const,
  skillIds: [input.skillId],
  inputSchema: input.schema,
  outputSchema: docxMutationOutputSchema,
  promptSpec: { name: input.name, description: input.description },
  resolveExecutionMeta: writeMeta,
  modelResult: input.modelResult,
  activityActionType: input.name
})

export const DOCX_CONTENT_EDIT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_content_edit',
  skillId: 'docx-write',
  schema: docxContentEditSchema,
  description:
    '创建 DOCX 或局部修改普通内容节点。一次只执行 replace_text、insert_nodes、replace_node、delete_node、move_node 之一；不负责格式、表格结构、媒体、批注或修订。成功表示写入及内部校验已完成；创建操作在 result.createdIds 返回新对象 ID。',
  modelResult: { renderSuccess: renderDocxContentEditModelResult }
})

export const DOCX_FORMAT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_format',
  skillId: 'docx-format',
  schema: docxFormatSchema,
  description:
    '原子修改一个或多个 DOCX 节点的显示格式，包括文字格式、段落格式、表格外观、section、命名样式或编号；同一局部 operation 对所有目标应用同一格式 patch。不负责改写正文内容、表格结构、媒体、批注或修订。省略的格式字段保持不变；update_named_style 会影响所有引用该样式的节点。成功表示写入及内部校验已完成。'
})

export const DOCX_TABLE_EDIT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_table_edit',
  skillId: 'docx-rich-write',
  schema: docxTableEditSchema,
  description:
    '创建、删除或修改 DOCX 表格结构，包括行列增删和单元格合并拆分；不负责修改已有单元格正文或纯外观格式。成功表示写入及内部校验已完成；创建表格时在 result.createdIds 返回新表格 ID。'
})

export const DOCX_MEDIA_EDIT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_media_edit',
  skillId: 'docx-rich-write',
  schema: docxMediaEditSchema,
  description:
    '插入、替换、删除或修改 DOCX 图片等视觉对象，负责媒体文件、relationship、尺寸和替代文字。成功表示写入及内部校验已完成；插入媒体时在 result.createdIds 返回新对象 ID。'
})

export const DOCX_COMMENTS_REVISIONS_TOOL_SPEC = defineMutationSpec({
  name: 'docx_comments_revisions',
  skillId: 'docx-rich-write',
  schema: docxCommentsRevisionsSchema,
  description:
    '新增、修改、回复或删除 Word 批注，切换修订模式，以及接受或拒绝 Word 修订；这不是文档读取检查工具。成功表示写入及内部校验已完成；新增批注或回复时在 result.createdIds 返回新批注 ID。'
})

export const DOCX_READ_TOOL_SPECS = [
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_NODES_TOOL_SPEC,
  DOCX_READ_VISUALS_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [DOCX_CONTENT_EDIT_TOOL_SPEC] as const

export const DOCX_FORMAT_TOOL_SPECS = [DOCX_FORMAT_TOOL_SPEC] as const

export const DOCX_RICH_WRITE_TOOL_SPECS = [
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_MEDIA_EDIT_TOOL_SPEC,
  DOCX_COMMENTS_REVISIONS_TOOL_SPEC
] as const

export const DOCX_MUTATION_TOOL_SPECS = [
  ...DOCX_WRITE_TOOL_SPECS,
  ...DOCX_FORMAT_TOOL_SPECS,
  ...DOCX_RICH_WRITE_TOOL_SPECS
] as const

export const DOCX_TOOL_SPECS = [...DOCX_READ_TOOL_SPECS, ...DOCX_MUTATION_TOOL_SPECS] as const
