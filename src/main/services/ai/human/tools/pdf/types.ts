import type { z } from 'zod/v4'
import type { WorkspaceCapabilityBuildInput } from '../types'
import type { pdfOutlineSchema, pdfReadPagesSchema, pdfSearchSchema } from './toolSchemas'

export type PdfCapabilityToolsInput = WorkspaceCapabilityBuildInput & {
  safePreviewChars: number
  modelContextWindowTokens: number
}

export type PdfOutlineRequest = z.infer<typeof pdfOutlineSchema>
export type PdfSearchRequest = z.infer<typeof pdfSearchSchema>
export type PdfReadPagesRequest = z.infer<typeof pdfReadPagesSchema>
