import type { AiRunContext } from '../types'

const labels = {
  cooperation_preferences: '合作偏好',
  project_background: '项目背景'
} as const

export function renderPartnerMemory(
  ctx: Pick<AiRunContext, 'partnerId' | 'partnerMemory'> & { isSubagent?: boolean }
): string {
  if (!ctx.partnerMemory) return ''
  const memories = ctx.partnerMemory.get(ctx.partnerId).memories.filter((memory) => memory.enabled)
  if (!memories.length) return ''
  return [
    '<长期记忆>',
    ...memories.map((memory) =>
      memory.category === 'cooperation_preferences'
        ? '合作偏好：用户长期的沟通方式、表达偏好、交付格式和协作习惯。'
        : '项目背景：持续项目的目标、重要事实和长期约定。'
    ),
    '',
    ctx.isSubagent
      ? '用户本次明确要求优先于记忆中的默认偏好。'
      : '发现值得长期保留或需要纠正的信息时，主动使用 memory 更新对应记忆；不记录临时要求和执行过程。用户本次明确要求优先于记忆中的默认偏好。',
    '',
    ...memories.map(
      (memory) => `<${labels[memory.category]}>\n${memory.confirmed}\n</${labels[memory.category]}>`
    ),
    '</长期记忆>'
  ].join('\n')
}
