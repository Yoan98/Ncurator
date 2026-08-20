import { z } from 'zod/v4'
import { visualRecognitionOutputSchema } from '../../../../visualRecognition/schemas'

const pdfMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.string().optional(),
  creator: z.string().optional(),
  producer: z.string().optional(),
  creationDate: z.string().optional(),
  modificationDate: z.string().optional()
})

const pdfOutlineItemSchema = z.object({
  title: z.string(),
  pageNumber: z.number().int().optional(),
  depth: z.number().int()
})

const pdfPageSchema = z.object({
  pageNumber: z.number().int(),
  text: z.string(),
  charCount: z.number().int(),
  textStatus: z.enum(['available', 'empty', 'suspicious']),
  imageCount: z.number().int(),
  width: z.number(),
  height: z.number(),
  rotation: z.number()
})

export const pdfInspectOutputSchema = z.object({
  sourcePath: z.string(),
  pageCount: z.number().int(),
  metadata: pdfMetadataSchema,
  outline: z.array(pdfOutlineItemSchema),
  encrypted: z.boolean()
})

export const pdfSearchOutputSchema = z.object({
  sourcePath: z.string(),
  pageCount: z.number().int(),
  query: z.string(),
  mode: z.enum(['literal', 'regex']),
  pageRange: z.object({ fromPage: z.number().int(), toPage: z.number().int() }),
  totalMatchCount: z.number().int(),
  returnedMatchCount: z.number().int(),
  matches: z.array(
    z.object({
      pageNumber: z.number().int(),
      matchedText: z.string(),
      snippet: z.string(),
      start: z.number().int(),
      end: z.number().int()
    })
  ),
  pagesWithNoTextCount: z.number().int(),
  pagesWithSuspiciousTextCount: z.number().int()
})

export const pdfReadPagesOutputSchema = z.object({
  sourcePath: z.string(),
  pageCount: z.number().int(),
  pages: z.array(pdfPageSchema)
})

export const pdfReadVisualsOutputSchema = visualRecognitionOutputSchema
