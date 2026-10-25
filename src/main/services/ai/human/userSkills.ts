import type { UserSkillService } from '../../skills/UserSkillService'
import { MAX_USER_SKILL_BODY_BYTES } from '../../../../shared/userSkills'
import type { AiRunContext } from '../types'

export type UserSkillReader = Pick<UserSkillService, 'listEnabled' | 'loadEnabled'>
export type UserSkillAccess = UserSkillReader &
  Partial<Pick<UserSkillService, 'getRootDirectory' | 'statusForPartner' | 'syncForPartner'>>
export type LoadedUserSkill = ReturnType<UserSkillReader['loadEnabled']>

export const isUserSkillId = (id: string): boolean => id.startsWith('user:')

export const loadCurrentUserSkills = (
  ctx: Pick<AiRunContext, 'partnerId' | 'userSkillService'>,
  ids: readonly string[]
): LoadedUserSkill[] => {
  if (!ctx.userSkillService) return []
  const enabled = ctx.userSkillService.listEnabled(ctx.partnerId)
  const requested = [...new Set(ids)].filter((id) => enabled.some((skill) => skill.id === id))
  if (!requested.length) return []
  const current = enabled.map((skill) => ctx.userSkillService!.loadEnabled(ctx.partnerId, skill.id))
  const bytes = current.reduce((sum, item) => sum + Buffer.byteLength(item.body, 'utf8'), 0)
  if (bytes > MAX_USER_SKILL_BODY_BYTES)
    throw new Error('Skill instructions exceed 64 KiB; adjust the enabled skills before continuing')
  const loaded = requested.map((id) => current.find((item) => item.skill.id === id)!)
  return loaded
}

const attribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const renderUserSkills = (
  ctx: Pick<AiRunContext, 'partnerId' | 'userSkillService'>,
  loaded: readonly LoadedUserSkill[] = []
): string => {
  const skills = ctx.userSkillService?.listEnabled(ctx.partnerId) || []
  if (!skills.length) return ''
  return [
    '技能：',
    '技能提供任务说明，通过 load_skill 按名称加载。',
    '',
    '可用技能：',
    ...[...skills]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, description }) => `- ${name}：${description}`),
    ...(loaded.length
      ? [
          '',
          '已加载技能：',
          '',
          loaded
            .map(
              ({ skill, body, resourceBase }) =>
                `<skill\n  name="${attribute(skill.name)}"\n  resourceBase="${attribute(resourceBase)}"\n>\n${body}\n</skill>`
            )
            .join('\n\n')
        ]
      : [])
  ].join('\n')
}
