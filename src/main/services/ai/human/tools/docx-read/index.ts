import { docxCapability } from '../docx'

const DOCX_READ_TOOL_NAMES = new Set([
  'docx_open',
  'docx_outline',
  'docx_get_block',
  'docx_search',
  'docx_get_history'
])

export const buildDocxReadTools = (input: Parameters<typeof docxCapability.buildTools>[0]) =>
  docxCapability.buildTools(input).filter((tool) => DOCX_READ_TOOL_NAMES.has(String(tool.name || '')))
