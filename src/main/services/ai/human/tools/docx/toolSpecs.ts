import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../../shared/runtimeCapabilities'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxCommentsRevisionsSchema,
  docxContentEditSchema,
  docxFormatSchema,
  docxOutlineSchema,
  docxReadNodesSchema,
  docxSearchSchema,
  docxTableEditSchema
} from './toolSchemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  renderDocxContentEditModelResult,
  renderDocxMutationModelResult,
  renderDocxOutlineModelResult,
  renderDocxReadNodesModelResult,
  renderDocxSearchModelResult
} from '../../shared/modelToolResultRenderers'

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
  TName extends RuntimeToolName = RuntimeToolName,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TName, TSkillId> & { activityActionType: string }

export const DOCX_READ_OUTLINE_TOOL_SPEC = {
  name: 'docx_read_outline',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxOutlineSchema,
  promptSpec: {
    name: 'docx_read_outline',
    description: '按根节点比例返回 DOCX 结构缩略图。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxOutlineModelResult
  },
  activityActionType: 'docx_read_outline'
} satisfies DocxToolSpec<z.infer<typeof docxOutlineSchema>, 'docx_read_outline', 'docx-read'>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxSearchSchema,
  promptSpec: {
    name: 'docx_search',
    description: '在 DOCX 全文中按文字或正则搜索。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxSearchModelResult
  },
  activityActionType: 'docx_search'
} satisfies DocxToolSpec<z.infer<typeof docxSearchSchema>, 'docx_search', 'docx-read'>

export const DOCX_READ_NODES_TOOL_SPEC = {
  name: 'docx_read_nodes',
  familyId: 'docx',
  skillIds: ['docx-read'],
  inputSchema: docxReadNodesSchema,
  promptSpec: {
    name: 'docx_read_nodes',
    description: '读取指定 nodeId 或 nodeIndex 范围的语义节点树。'
  },
  resolveExecutionMeta: readMeta,
  modelResult: {
    renderSuccess: renderDocxReadNodesModelResult
  },
  activityActionType: 'docx_read_nodes'
} satisfies DocxToolSpec<z.infer<typeof docxReadNodesSchema>, 'docx_read_nodes', 'docx-read'>

const defineMutationSpec = <
  TName extends RuntimeToolName,
  TSchema extends z.ZodType,
  TSkillId extends RuntimeSkillId
>(input: {
  name: TName
  skillId: TSkillId
  schema: TSchema
  description: string
  modelResult: HumanToolSpec['modelResult']
}) => ({
  name: input.name,
  familyId: 'docx' as const,
  skillIds: [input.skillId],
  inputSchema: input.schema,
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
    '创建 DOCX，或对正文节点执行 replace_text、insert_nodes、replace_node、delete_node、move_node 之一。',
  modelResult: { renderSuccess: renderDocxContentEditModelResult }
})

export const DOCX_FORMAT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_format',
  skillId: 'docx-write',
  schema: docxFormatSchema,
  description: '修改已有内容的显示格式：局部文字、段落、命名样式、编号和 section。',
  modelResult: { renderSuccess: renderDocxMutationModelResult }
})

export const DOCX_TABLE_EDIT_TOOL_SPEC = defineMutationSpec({
  name: 'docx_table_edit',
  skillId: 'docx-write',
  schema: docxTableEditSchema,
  description: '修改表格结构（行列、合并拆分）以及表、行、单元格外观。',
  modelResult: { renderSuccess: renderDocxMutationModelResult }
})

export const DOCX_COMMENTS_REVISIONS_TOOL_SPEC = defineMutationSpec({
  name: 'docx_comments_revisions',
  skillId: 'docx-write',
  schema: docxCommentsRevisionsSchema,
  description: '新增、修改、回复或删除批注；开关修订模式；接受或拒绝修订。',
  modelResult: { renderSuccess: renderDocxMutationModelResult }
})

export const DOCX_READ_TOOL_SPECS = [
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_NODES_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [
  DOCX_CONTENT_EDIT_TOOL_SPEC,
  DOCX_FORMAT_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_COMMENTS_REVISIONS_TOOL_SPEC
] as const

export const DOCX_TOOL_SPECS = [...DOCX_READ_TOOL_SPECS, ...DOCX_WRITE_TOOL_SPECS] as const
