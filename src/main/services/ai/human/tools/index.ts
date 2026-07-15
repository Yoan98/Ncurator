import type { AiToolFamilyId, ToolFamilyDefinition } from './types'
import { docxToolFamily } from './docx'
import { imageRecognitionToolFamily } from './imageRecognition'
import { buildKbCapabilityTools } from './kb/retrievalTools'
import { terminalToolFamily } from './terminal'
import { textFileToolFamily } from './textFile'
import { utilityToolFamily } from './utility'
import { webToolFamily } from './web'

export const kbToolFamily: ToolFamilyDefinition = {
  familyId: 'kb',
  buildTools: ({ ctx, runId, taskId }) => buildKbCapabilityTools({ ctx, runId, taskId })
}

export const TOOL_FAMILY_DEFINITIONS: Record<AiToolFamilyId, ToolFamilyDefinition> = {
  terminal: terminalToolFamily,
  'text-file': textFileToolFamily,
  kb: kbToolFamily,
  docx: docxToolFamily,
  web: webToolFamily,
  utility: utilityToolFamily,
  'image-recognition': imageRecognitionToolFamily
}

export const getToolFamilyDefinition = (familyId: AiToolFamilyId): ToolFamilyDefinition =>
  TOOL_FAMILY_DEFINITIONS[familyId]
