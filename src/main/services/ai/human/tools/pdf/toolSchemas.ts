import { z } from 'zod/v4'

const sourcePathSchema = z.string().trim().min(1).describe('PDF 文件本机绝对路径')
const pageNumberSchema = z.number().int().min(1).describe('1-based 页码')

export const pdfOutlineSchema = z
  .object({
    sourcePath: sourcePathSchema
  })
  .strict()

export const pdfPageRangeSchema = z
  .object({
    fromPage: pageNumberSchema.describe('起始页码'),
    toPage: pageNumberSchema.describe('结束页码')
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
    selection: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('page_range').describe('连续页码区间'),
            fromPage: pageNumberSchema.describe('起始页码'),
            toPage: pageNumberSchema.describe('结束页码')
          })
          .strict(),
        z
          .object({
            type: z.literal('page_numbers').describe('指定页码集合'),
            pageNumbers: z
              .array(pageNumberSchema)
              .min(1)
              .max(50)
              .describe('1 至 50 个页码')
          })
          .strict()
      ])
      .describe('页码选择方式')
  })
  .strict()

export type {
  PdfOutlineOutput,
  PdfPageOutput,
  PdfReadPagesOutput,
  PdfSearchOutput
} from './outputTypes'
