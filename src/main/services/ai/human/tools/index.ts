import type { AiToolFamilyId, ToolFamilyDefinition } from './types'
import { docxToolFamily } from './docx'
import { internalToolFamily } from './internal'
import { buildKbCapabilityTools } from './kb/retrievalTools'
import { terminalToolFamily } from './terminal'

export const kbToolFamily: ToolFamilyDefinition = {
  familyId: 'kb',
  buildTools: ({ ctx, runId, taskId }) => buildKbCapabilityTools({ ctx, runId, taskId })
}

export const TOOL_FAMILY_DEFINITIONS: Record<AiToolFamilyId, ToolFamilyDefinition> = {
  terminal: terminalToolFamily,
  kb: kbToolFamily,
  docx: docxToolFamily,
  internal: internalToolFamily
}

export const getToolFamilyDefinition = (familyId: AiToolFamilyId): ToolFamilyDefinition =>
  TOOL_FAMILY_DEFINITIONS[familyId]
