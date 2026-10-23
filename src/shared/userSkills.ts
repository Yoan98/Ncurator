/** Shared assets are opt-in for each partner; their instructions never register tools. */
export type UserSkill = {
  id: string
  name: string
  description: string
  directoryName: string
  createdAt: number
}

export const MAX_USER_SKILL_BODY_BYTES = 64 * 1024

export type UserSkillDraft = { name: string; description: string; body: string }
export type UserSkillDocument = UserSkill & { body: string }
export type UserSkillCreateRequest = UserSkillDraft
export type UserSkillUpdateRequest = UserSkillDraft & { id: string }
export type UserSkillImportPreview = {
  token: string
  name: string
  description: string
  conflict: UserSkill | null
}
export type UserSkillImportCommitRequest = { token: string; replaceExisting: boolean }
export type UserSkillSelection = {
  skillIds: string[]
  bodyBytes: number
  maxBodyBytes: number
  unavailableSkillNames: string[]
}
export type UserSkillSetEnabledRequest = { partnerId: string; skillIds: string[] }
