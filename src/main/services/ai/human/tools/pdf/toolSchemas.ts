import { z } from 'zod/v4'
import { PDF_SEARCH_MAX_MATCHES } from './constants'

const sourcePathSchema = z.string().trim().min(1).describe('PDF 文件本机绝对路径')
const pageNumberSchema = z.number().int().min(1).describe('1-based 页码')

export const pdfOutlineSchema = z
  .object({
    sourcePath: sourcePathSchema
  })
  .strict()

export const pdfPageRangeSchema = z
  .object({
    fromPage: pageNumberSchema,
    toPage: pageNumberSchema
  })
  .strict()

export const pdfSearchSchema = z
  .object({
    sourcePath: sourcePathSchema,
    query: z.string().min(1).describe('检索文字或正则'),
    mode: z.enum(['literal', 'regex']).optional().describe('literal 或 regex，缺省 literal'),
    pageRange: pdfPageRangeSchema.optional().describe('可选页码范围；省略则全书')
  })
  .strict()

export const pdfReadPagesSchema = z
  .object({
    sourcePath: sourcePathSchema,
    selection: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('page_range'),
          fromPage: pageNumberSchema,
          toPage: pageNumberSchema
        })
        .strict(),
      z
        .object({
          type: z.literal('page_numbers'),
          pageNumbers: z.array(pageNumberSchema).min(1).max(50)
        })
        .strict()
    ])
  })
  .strict()

const pdfMetadataSchema = z
  .object({
    title: z.string().optional(),
    author: z.string().optional(),
    subject: z.string().optional(),
    keywords: z.string().optional(),
    creator: z.string().optional(),
    producer: z.string().optional(),
    creationDate: z.string().optional(),
    modificationDate: z.string().optional()
  })
  .strict()

const pdfOutlineItemSchema = z
  .object({
    title: z.string(),
    pageNumber: z.number().int().optional(),
    depth: z.number().int()
  })
  .strict()

const pdfPageOutputSchema = z
  .object({
    pageNumber: z.number().int(),
    text: z.string(),
    textStatus: z.enum(['available', 'empty', 'suspicious']),
    imageCount: z.number().int(),
    pageImagePath: z.string()
  })
  .strict()

export const pdfOutlineOutputSchema = z
  .object({
    pageCount: z.number().int(),
    metadata: pdfMetadataSchema,
    outline: z.array(pdfOutlineItemSchema)
  })
  .strict()

export const pdfSearchOutputSchema = z
  .object({
    totalMatchCount: z.number().int(),
    returnedMatchCount: z.number().int(),
    matches: z
      .array(
        z
          .object({
            pageNumber: z.number().int(),
            matchedText: z.string(),
            snippet: z.string(),
            start: z.number().int(),
            end: z.number().int()
          })
          .strict()
      )
      .max(PDF_SEARCH_MAX_MATCHES),
    pagesWithNoTextCount: z.number().int(),
    pagesWithSuspiciousTextCount: z.number().int()
  })
  .strict()

export const pdfReadPagesOutputSchema = z
  .object({
    pages: z.array(pdfPageOutputSchema)
  })
  .strict()
