import type { SkillManagementRead } from '../../../../skills/UserSkillService'

export type SkillReadOutput =
  | SkillManagementRead
  | { id: string; path: string; enabled: boolean }
  | { filePath: string }
export type SkillEditOutput = { id: string; name: string }
