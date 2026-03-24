import { RUNTIME_SKILL_IDS } from '../../constants'
import type { RuntimeSkillId, SkillCatalogItem, SkillDefinition } from '../../types'
import {
  getRuntimeSkillDefinition,
  listRuntimeSkillCatalogItems
} from '../../tools/toolCatalog'

export const buildSkillCatalog = (): SkillCatalogItem[] => listRuntimeSkillCatalogItems()

export const getSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition =>
  getRuntimeSkillDefinition(skillId)

export const hasSkillDefinition = (skillId: string): skillId is RuntimeSkillId =>
  RUNTIME_SKILL_IDS.includes(skillId as RuntimeSkillId)
