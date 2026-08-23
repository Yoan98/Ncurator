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
import { webToolFamily } from './web'
import { agentControlToolFamily } from './agentControl'

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
  'image-recognition': imageRecognitionToolFamily,
  'image-generation': imageGenerationToolFamily,
  'agent-control': agentControlToolFamily
}

export const getToolFamilyDefinition = (familyId: AiToolFamilyId): ToolFamilyDefinition =>
  TOOL_FAMILY_DEFINITIONS[familyId]
