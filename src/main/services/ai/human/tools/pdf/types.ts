import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import type { pdfInspectSchema, pdfReadPagesSchema, pdfSearchSchema } from './schemas'

export type PdfCapabilityToolsInput = WorkspaceCapabilityBuildInput & {
  safePreviewChars: number
  modelContextWindowTokens: number
}

export type PdfInspectRequest = z.infer<typeof pdfInspectSchema>
export type PdfSearchRequest = z.infer<typeof pdfSearchSchema>
export type PdfReadPagesRequest = z.infer<typeof pdfReadPagesSchema>
