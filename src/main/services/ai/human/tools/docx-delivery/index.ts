import { docxCapability } from '../docx'

const DOCX_DELIVERY_TOOL_NAMES = new Set(['docx_validate', 'docx_render_preview', 'docx_save'])

export const buildDocxDeliveryTools = (input: Parameters<typeof docxCapability.buildTools>[0]) =>
  docxCapability
    .buildTools(input)
    .filter((tool) => DOCX_DELIVERY_TOOL_NAMES.has(String(tool.name || '')))
