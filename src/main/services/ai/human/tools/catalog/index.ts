import type { RuntimeSkillId } from '../../types'
import type { CapabilitySkillDefinition, CapabilityToolDefinition } from './factories'
import { CATALOG_SKILL_DEFINITIONS } from './skillDefinitions'
import { DOCX_TOOL_DEFINITIONS } from './toolDescriptors/docx'
import { KB_TOOL_DEFINITIONS } from './toolDescriptors/kb'
import { TERMINAL_TOOL_DEFINITIONS } from './toolDescriptors/terminal'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, CapabilitySkillDefinition> =
  CATALOG_SKILL_DEFINITIONS

export const CATALOG_TOOL_CONTRACTS = [
  ...TERMINAL_TOOL_DEFINITIONS,
  ...KB_TOOL_DEFINITIONS,
  ...DOCX_TOOL_DEFINITIONS
 ] as const

export const getCatalogSkillDefinition = (
  skillId: RuntimeSkillId
): CapabilitySkillDefinition => SKILL_DEFINITIONS[skillId]

export const listCatalogToolContracts = (): CapabilityToolDefinition[] => [...CATALOG_TOOL_CONTRACTS]
