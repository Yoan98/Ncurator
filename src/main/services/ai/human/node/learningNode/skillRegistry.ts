import { RUNTIME_SKILL_IDS } from '../../constants'
import type { RuntimeSkillId, SkillCatalogItem, SkillDefinition } from '../../types'
import { CAPABILITY_SKILL_DEFINITIONS } from '../../tools/capabilityRegistry'
import { listToolDescriptorsBySkill, listToolNamesBySkill } from '../../tools/toolCatalog'

const buildSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => {
  const descriptors = listToolDescriptorsBySkill(skillId)
  if (descriptors.length === 0) {
    throw new Error(`tool catalog has no tools bound for skill ${skillId}`)
  }

  const familyIds = Array.from(new Set(descriptors.map((descriptor) => descriptor.familyId)))
  if (familyIds.length !== 1) {
    throw new Error(`skill ${skillId} must bind tools from exactly one family`)
  }

  const metadata = CAPABILITY_SKILL_DEFINITIONS[skillId]
  return {
    skillId,
    familyId: familyIds[0],
    title: metadata.title,
    summary: metadata.summary,
    toolNames: listToolNamesBySkill(skillId),
    whenToUse: metadata.whenToUse,
    detail: metadata.detail
  }
}

const SKILL_DEFINITIONS: Record<RuntimeSkillId, SkillDefinition> = Object.fromEntries(
  RUNTIME_SKILL_IDS.map((skillId) => [skillId, buildSkillDefinition(skillId)])
) as Record<RuntimeSkillId, SkillDefinition>

export const buildSkillCatalog = (): SkillCatalogItem[] =>
  RUNTIME_SKILL_IDS.map((skillId) => SKILL_DEFINITIONS[skillId]).map((definition) => ({
    skillId: definition.skillId,
    familyId: definition.familyId,
    title: definition.title,
    summary: definition.summary,
    toolNames: [...definition.toolNames],
    whenToUse: definition.whenToUse
  }))

export const getSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => SKILL_DEFINITIONS[skillId]

export const hasSkillDefinition = (skillId: string): skillId is RuntimeSkillId =>
  skillId in SKILL_DEFINITIONS
