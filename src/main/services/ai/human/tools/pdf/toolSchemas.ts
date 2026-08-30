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

const pdfMetadataSchema = z
  .object({
    title: z.string().optional().describe('文档标题'),
    author: z.string().optional().describe('作者'),
    subject: z.string().optional().describe('主题'),
    keywords: z.string().optional().describe('关键词'),
    creator: z.string().optional().describe('创建应用'),
    producer: z.string().optional().describe('生成应用'),
    creationDate: z.string().optional().describe('创建时间'),
    modificationDate: z.string().optional().describe('修改时间')
  })
  .strict()

const pdfOutlineItemSchema = z
  .object({
    title: z.string().describe('书签标题'),
    pageNumber: z.number().int().optional().describe('目标页码'),
    depth: z.number().int().describe('书签层级，从 1 开始')
  })
  .strict()

const pdfPageOutputSchema = z
  .object({
    pageNumber: z.number().int().describe('页码'),
    text: z.string().describe('页面文本层内容'),
    textStatus: z
      .enum(['available', 'empty', 'suspicious'])
      .describe('文本层状态：available=可读，empty=无文本层，suspicious=可疑编码'),
    imageCount: z.number().int().describe('页面内嵌图片数量'),
    pageImagePath: z.string().describe('该页渲染图片的本机绝对路径')
  })
  .strict()

export const pdfOutlineOutputSchema = z
  .object({
    pageCount: z.number().int().describe('总页数'),
    metadata: pdfMetadataSchema.describe('文档元数据'),
    outline: z.array(pdfOutlineItemSchema).describe('书签提纲；无书签时为空数组')
  })
  .strict()

export const pdfSearchOutputSchema = z
  .object({
    totalMatchCount: z.number().int().describe('全书命中总数'),
    returnedMatchCount: z.number().int().describe('本次返回命中数'),
    matches: z
      .array(
        z
          .object({
            pageNumber: z.number().int().describe('命中页码'),
            matchedText: z.string().describe('匹配文字'),
            snippet: z.string().describe('命中附近上下文'),
            start: z.number().int().describe('页内起始偏移'),
            end: z.number().int().describe('页内结束偏移')
          })
          .strict()
      )
      .max(PDF_SEARCH_MAX_MATCHES)
      .describe(`命中列表，最多 ${PDF_SEARCH_MAX_MATCHES} 条`),
    pagesWithNoTextCount: z.number().int().describe('无文本层页数'),
    pagesWithSuspiciousTextCount: z.number().int().describe('可疑文本层页数')
  })
  .strict()

export const pdfReadPagesOutputSchema = z
  .object({
    pages: z.array(pdfPageOutputSchema).describe('按请求顺序返回的页面列表')
  })
  .strict()
