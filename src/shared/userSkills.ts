/** Shared assets are opt-in for each partner; their instructions never register tools. */
export type UserSkill = {
  id: string
  name: string
  description: string
  directoryName: string
  createdAt: number
}

export type UserSkillCreateRequest = { content: string }
export type UserSkillSetEnabledRequest = { partnerId: string; skillIds: string[] }
