/** Internal identity never enters Skill instructions or the model-facing name catalog. */
export type UserSkill = { name: string; description: string }
export type SkillIdentity = {
  id: string
  name: string
  officialId?: string
  displayName?: string
  version?: string
  baselineSha256?: string
}
export type UserSkillOption = UserSkill &
  SkillIdentity & { bodyBytes: number | null; error?: string }
export const MAX_USER_SKILL_BODY_BYTES = 64 * 1024
export type UserSkillDraft = { name: string; description: string; body: string }
export type UserSkillDocument = UserSkill & { body: string; resources: string[] }
export type UserSkillCreateRequest = UserSkillDraft
export type UserSkillUpdateRequest = UserSkillDraft & { originalName: string }
export type UserSkillImportPreview = {
  token: string
  name: string
  description: string
  body: string
  resources: string[]
}
export type UserSkillImportCommitRequest = UserSkillDraft & {
  token: string
  replaceName: string | null
}
export type UserSkillSource = { name: string } | { token: string }
export type UserSkillResourcePreview = { text: string } | { image: string } | null
export type UserSkillSelection = {
  skillNames: string[]
  bodyBytes: number
  maxBodyBytes: number
  unavailableSkillNames: string[]
}
