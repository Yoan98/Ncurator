import { z } from 'zod/v4'
import { visualRecognitionRequestSchema } from '../visualRecognition/schemas'

const sourcePathSchema = z.string().trim().min(1)
const pageNumberSchema = z.number().int().min(1)

export const pdfInspectSchema = z.object({
  sourcePath: sourcePathSchema
})

export const pdfPageRangeSchema = z.object({
  fromPage: pageNumberSchema,
  toPage: pageNumberSchema
})

export const pdfSearchSchema = z.object({
  sourcePath: sourcePathSchema,
  query: z.string().min(1),
  mode: z.enum(['literal', 'regex']).optional(),
  pageRange: pdfPageRangeSchema.optional(),
  maxMatches: z.number().int().min(1).max(50).optional()
})

export const pdfReadPagesSchema = z.object({
  sourcePath: sourcePathSchema,
  selection: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('page_range'),
      fromPage: pageNumberSchema,
      toPage: pageNumberSchema
    }),
    z.object({
      type: z.literal('page_numbers'),
      pageNumbers: z.array(pageNumberSchema).min(1).max(50)
    })
  ])
})

export const pdfReadVisualsSchema = z
  .object({
    sourcePath: sourcePathSchema,
    requests: z.array(visualRecognitionRequestSchema).min(1).max(10)
  })
  .strict()
