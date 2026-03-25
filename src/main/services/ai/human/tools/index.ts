import type { AiToolFamilyId, ToolFamilyDefinition } from './types'
import { docxToolFamily } from './docx'
import { kbToolFamily } from './kb'
import { terminalToolFamily } from './terminal'

export const TOOL_FAMILY_DEFINITIONS: Record<AiToolFamilyId, ToolFamilyDefinition> = {
  terminal: terminalToolFamily,
  kb: kbToolFamily,
  docx: docxToolFamily
}

export const getToolFamilyDefinition = (familyId: AiToolFamilyId): ToolFamilyDefinition =>
  TOOL_FAMILY_DEFINITIONS[familyId]
