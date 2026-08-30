import { z } from 'zod/v4'

export const WEB_SEARCH_SCHEMA = z
  .object({
    query: z.string().min(1).optional().describe('搜索关键词；与 url 二选一'),
    url: z.string().min(1).optional().describe('直接抓取的网页 URL；与 query 二选一')
  })
  .strict()
  .refine((value) => Boolean(value.query) !== Boolean(value.url), {
    message: 'query 与 url 必须二选一'
  })

export const BROWSER_USE_SCHEMA = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('navigate').describe('打开 URL 并加载页面'),
      url: z.string().min(1).describe('目标 URL'),
      instruction: z.string().optional().describe('可选操作说明')
    })
    .strict(),
  z
    .object({
      action: z.literal('extract').describe('提取当前页面内容'),
      instruction: z.string().min(1).describe('提取目标或范围说明')
    })
    .strict(),
  z
    .object({
      action: z.literal('observe').describe('列出当前页面可见交互动作'),
      instruction: z.string().min(1).describe('观察目标说明')
    })
    .strict(),
  z
    .object({
      action: z.literal('act').describe('在当前页面执行交互动作'),
      instruction: z.string().min(1).describe('要执行的动作说明')
    })
    .strict()
])

const webSearchLinkItemSchema = z
  .object({
    href: z.string(),
    text: z.string().optional(),
    title: z.string().optional()
  })
  .strict()

export const webSearchItemSchema = z
  .object({
    requestedUrl: z.string(),
    finalUrl: z.string().optional(),
    title: z.string().optional(),
    markdown: z.string().optional(),
    links: z
      .object({
        internal: z.array(webSearchLinkItemSchema),
        external: z.array(webSearchLinkItemSchema)
      })
      .optional(),
    publishedAt: z.string().optional(),
    error: z.string().optional(),
    statusCode: z.number().int().optional()
  })
  .strict()

export const WEB_SEARCH_OUTPUT_SCHEMA = z
  .object({
    items: z.array(webSearchItemSchema)
  })
  .strict()

const browserUsePageOutputSchema = z
  .object({
    url: z.string(),
    title: z.string().optional()
  })
  .strict()

const browserActionCandidateOutputSchema = z
  .object({
    description: z.string(),
    method: z.string().optional(),
    arguments: z.array(z.string()).optional()
  })
  .strict()

export const BROWSER_USE_OUTPUT_SCHEMA = z.union([
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('navigate'),
        page: browserUsePageOutputSchema
      })
      .strict(),
    z
      .object({
        action: z.literal('extract'),
        page: browserUsePageOutputSchema,
        content: z.string()
      })
      .strict(),
    z
      .object({
        action: z.literal('observe'),
        page: browserUsePageOutputSchema,
        actions: z.array(browserActionCandidateOutputSchema)
      })
      .strict(),
    z
      .object({
        action: z.literal('act'),
        page: browserUsePageOutputSchema,
        success: z.boolean(),
        message: z.string(),
        actionDescription: z.string(),
        actions: z.array(browserActionCandidateOutputSchema).optional()
      })
      .strict()
  ]),
  z
    .object({
      action: z.enum(['navigate', 'extract', 'observe', 'act']).optional(),
      page: browserUsePageOutputSchema.optional(),
      error: z.string()
    })
    .strict()
])
