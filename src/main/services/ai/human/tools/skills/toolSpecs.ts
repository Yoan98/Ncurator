import type { HumanToolSpec, ModelResultRenderer } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import { escapeXmlAttribute } from '../../shared/renderFamilies/shared'
import {
  SKILL_READ_SCHEMA,
  SKILL_EDIT_SCHEMA,
  type SkillReadInput,
  type SkillEditInput
} from './toolSchemas'
import type { SkillReadOutput, SkillEditOutput } from './outputTypes'

export const renderSkillRead: ModelResultRenderer = ({ data }) => {
  const output = data as SkillReadOutput
  if ('filePath' in output)
    return `完整 skill 清单：${output.filePath}\n请使用 text_file_read 读取。`
  if ('skills' in output)
    return output.skills.length
      ? output.skills
          .map(
            (skill) =>
              `- ${skill.name} [id=${skill.id}; ${skill.enabled ? '已启用' : '未启用'}]\n  ${skill.description}`
          )
          .join('\n')
      : '没有共享 skill。'
  const header = `<skill_document id="${escapeXmlAttribute(output.id)}" path="${escapeXmlAttribute(output.path)}" enabled="${output.enabled}">`
  return [
    header,
    'content' in output
      ? output.content
      : `正文较长，请使用 text_file_read 读取 ${output.path}/SKILL.md。`,
    '</skill_document>'
  ].join('\n')
}

export const renderSkillEdit: ModelResultRenderer = ({ args, data }) => {
  const output = data as SkillEditOutput
  const action = args.sourcePath ? (args.id ? '更新' : '创建') : ''
  const enabled = typeof args.enabled === 'boolean' ? (args.enabled ? '启用' : '停用') : ''
  return `已${[action, enabled].filter(Boolean).join('并')}${output.name}。id=${output.id}`
}

export const SKILL_READ_SPEC: HumanToolSpec<SkillReadInput, 'skill_read', 'skill-management'> = {
  name: 'skill_read',
  familyId: 'skill-management',
  toolsetIds: ['skill-management'],
  inputSchema: SKILL_READ_SCHEMA,
  promptSpec: {
    name: 'skill_read',
    description: '读取共享 skill 的目录或说明原文。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'skill-management'
  }),
  modelResult: { renderSuccess: renderSkillRead }
}

export const SKILL_EDIT_SPEC: HumanToolSpec<SkillEditInput, 'skill_edit', 'skill-management'> = {
  name: 'skill_edit',
  familyId: 'skill-management',
  toolsetIds: ['skill-management'],
  inputSchema: SKILL_EDIT_SCHEMA,
  promptSpec: {
    name: 'skill_edit',
    description: '编辑，创建本地的skill，或配置是否启用。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'skill-management'
  }),
  modelResult: { renderSuccess: renderSkillEdit }
}

export const SKILL_MANAGEMENT_TOOL_SPECS = [SKILL_READ_SPEC, SKILL_EDIT_SPEC] as const
