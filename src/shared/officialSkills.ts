export type OfficialSkill = {
  id: string
  name: string
  displayName: string
  description: string
  iconUrl: string | null
  version: string
  minClientVersion: string
  releaseNotes: string
  downloadUrl: string
  sha256: string
}
export type OfficialSkillCatalog = { items: OfficialSkill[]; offline?: boolean }
export type OfficialSkillDownload = {
  token: string
  skill: OfficialSkill
  replacing: boolean
  locallyModified: boolean
}
