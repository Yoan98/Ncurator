import type { HumanToolSpec, ModelResultRenderer } from '../types'
import { SKILL_SYNC_SCHEMA, type SkillSyncInput } from './toolSchemas'
import type { SkillSyncOutput } from './outputTypes'

export const renderSkillSync: ModelResultRenderer = ({ data }) => {
  const output = data as SkillSyncOutput
  if (Array.isArray(output))
    return output.length
      ? output.map((skill) => `- ${skill.name}：${skill.enabled ? '已启用' : '未启用'}`).join('\n')
      : '没有已登记的 Skill。'
  if ('filePath' in output)
    return `完整 Skill 状态清单：${output.filePath}\n可使用 text_file_read 读取。`
  return `${output.warning ? '已停用' : '已同步'} ${output.name}，当前${output.enabled ? '已启用' : '未启用'}。${output.warning ? `\n${output.warning}` : ''}`
}

export const SKILL_SYNC_SPEC: HumanToolSpec<SkillSyncInput, 'skill_sync', 'skill-management'> = {
  name: 'skill_sync',
  familyId: 'skill-management',
  toolsetIds: ['skill-management'],
  inputSchema: SKILL_SYNC_SCHEMA,
  promptSpec: {
    name: 'skill_sync',
    description: '查询 Skill 启用状态，或同步 Skill 目录到skill数据库并配置当前伙伴的启用状态。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: args.action === 'status' ? 'read_only' : 'mutating',
    resourceKey: 'skill-management'
  }),
  modelResult: {
    renderSuccess: renderSkillSync,
    renderError: ({ data }) =>
      `Error: ${data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' ? data.error : 'Skill sync failed'}`
  }
}

export const SKILL_MANAGEMENT_TOOL_SPECS = [SKILL_SYNC_SPEC] as const
