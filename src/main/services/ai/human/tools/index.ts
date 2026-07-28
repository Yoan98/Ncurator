import type { AiToolFamilyId, ToolFamilyDefinition } from './types'
import { docxToolFamily } from './docx'
import { excelToolFamily } from './excel'
import { imageRecognitionToolFamily } from './imageRecognition'
import { imageGenerationToolFamily } from './imageGeneration'
import { pdfToolFamily } from './pdf'
import { pptToolFamily } from './ppt'
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
  pdf: pdfToolFamily,
  ppt: pptToolFamily,
  excel: excelToolFamily,
  web: webToolFamily,
  utility: utilityToolFamily,
  'image-recognition': imageRecognitionToolFamily,
  'image-generation': imageGenerationToolFamily
}

export const getToolFamilyDefinition = (familyId: AiToolFamilyId): ToolFamilyDefinition =>
  TOOL_FAMILY_DEFINITIONS[familyId]
