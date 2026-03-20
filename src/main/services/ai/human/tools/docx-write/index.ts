import { docxCapability } from '../docx'

const DOCX_WRITE_TOOL_NAMES = new Set(['docx_apply_ops', 'docx_rollback'])

export const buildDocxWriteTools = (input: Parameters<typeof docxCapability.buildTools>[0]) =>
  docxCapability.buildTools(input).filter((tool) => DOCX_WRITE_TOOL_NAMES.has(String(tool.name || '')))
