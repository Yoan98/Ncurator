import type { SkillStatus, SkillSyncResult } from '../../../../skills/UserSkillService'

export type SkillSyncOutput = SkillStatus[] | SkillSyncResult | { filePath: string }
