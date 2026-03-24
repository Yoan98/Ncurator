import { CAPABILITY_SKILL_DEFINITIONS } from './tools/capabilityRegistry'

export const SKILL_METADATA = Object.fromEntries(
  Object.entries(CAPABILITY_SKILL_DEFINITIONS).map(([skillId, definition]) => [
    skillId,
    {
      title: definition.title,
      summary: definition.summary,
      whenToUse: definition.whenToUse,
      detail: definition.detail
    }
  ])
) as Record<
  keyof typeof CAPABILITY_SKILL_DEFINITIONS,
  {
    title: string
    summary: string
    whenToUse: string
    detail: string
  }
>
