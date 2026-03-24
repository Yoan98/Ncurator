import type { RuntimeSkillId } from '../../types'
import type { AiToolFamilyId } from '../types'
import type { CapabilitySkillDefinition, CapabilityToolDefinition } from './factories'
import { CATALOG_SKILL_DEFINITIONS } from './skillDefinitions'
import { DOCX_TOOL_DEFINITIONS } from './toolDescriptors/docx'
import { KB_TOOL_DEFINITIONS } from './toolDescriptors/kb'
import { TERMINAL_TOOL_DEFINITIONS } from './toolDescriptors/terminal'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, CapabilitySkillDefinition> =
  CATALOG_SKILL_DEFINITIONS

export const TOOL_DEFINITIONS: readonly CapabilityToolDefinition[] = [
  ...TERMINAL_TOOL_DEFINITIONS,
  ...KB_TOOL_DEFINITIONS,
  ...DOCX_TOOL_DEFINITIONS
]

const TOOL_DEFINITIONS_BY_FAMILY = new Map<AiToolFamilyId, CapabilityToolDefinition[]>()

TOOL_DEFINITIONS.forEach((definition) => {
  const familyDefinitions = TOOL_DEFINITIONS_BY_FAMILY.get(definition.familyId) || []
  familyDefinitions.push(definition)
  TOOL_DEFINITIONS_BY_FAMILY.set(definition.familyId, familyDefinitions)
})

export const getCatalogSkillDefinition = (
  skillId: RuntimeSkillId
): CapabilitySkillDefinition => SKILL_DEFINITIONS[skillId]

export const listCatalogToolDefinitions = (): CapabilityToolDefinition[] => [...TOOL_DEFINITIONS]

export const listCatalogToolDefinitionsByFamily = (
  familyId: AiToolFamilyId
): CapabilityToolDefinition[] => [...(TOOL_DEFINITIONS_BY_FAMILY.get(familyId) || [])]
