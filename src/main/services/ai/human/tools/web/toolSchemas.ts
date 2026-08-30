import { z } from 'zod/v4'

export const WEB_SEARCH_SCHEMA = z
  .object({
    query: z.string().min(1).optional().describe('搜索关键词'),
    url: z.string().min(1).optional().describe('直接抓取的网页 URL')
  })
  .strict()
  .refine((value) => Boolean(value.query) !== Boolean(value.url), {
    message: 'query 与 url 必须二选一'
  })

export const BROWSER_USE_SCHEMA = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('navigate'),
      url: z.string().min(1),
      instruction: z.string().optional()
    })
    .strict(),
  z
    .object({
      action: z.literal('extract'),
      instruction: z.string().min(1)
    })
    .strict(),
  z
    .object({
      action: z.literal('observe'),
      instruction: z.string().min(1)
    })
    .strict(),
  z
    .object({
      action: z.literal('act'),
      instruction: z.string().min(1)
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
