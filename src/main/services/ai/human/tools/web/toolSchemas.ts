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
    href: z.string().describe('链接 URL'),
    text: z.string().optional().describe('链接文本'),
    title: z.string().optional().describe('链接标题')
  })
  .strict()

export const webSearchItemSchema = z
  .object({
    requestedUrl: z.string().describe('请求的 URL'),
    finalUrl: z.string().optional().describe('最终落地 URL'),
    title: z.string().optional().describe('页面标题'),
    markdown: z.string().optional().describe('页面正文（Markdown）'),
    links: z
      .object({
        internal: z.array(webSearchLinkItemSchema).describe('站内链接'),
        external: z.array(webSearchLinkItemSchema).describe('站外链接')
      })
      .optional()
      .describe('页面链接分组'),
    publishedAt: z.string().optional().describe('发布时间（ISO 8601）'),
    error: z.string().optional().describe('抓取错误信息'),
    statusCode: z.number().int().optional().describe('HTTP 状态码')
  })
  .strict()

export const WEB_SEARCH_OUTPUT_SCHEMA = z
  .object({
    items: z.array(webSearchItemSchema).describe('搜索结果或抓取页面列表')
  })
  .strict()

const browserUsePageOutputSchema = z
  .object({
    url: z.string().describe('当前页面 URL'),
    title: z.string().optional().describe('当前页面标题')
  })
  .strict()

const browserActionCandidateOutputSchema = z
  .object({
    description: z.string().describe('可执行动作描述'),
    method: z.string().optional().describe('动作方法名'),
    arguments: z.array(z.string()).optional().describe('动作参数')
  })
  .strict()

export const BROWSER_USE_OUTPUT_SCHEMA = z.union([
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('navigate').describe('导航动作'),
        page: browserUsePageOutputSchema.describe('当前页面信息')
      })
      .strict(),
    z
      .object({
        action: z.literal('extract').describe('提取动作'),
        page: browserUsePageOutputSchema.describe('当前页面信息'),
        content: z.string().describe('提取到的页面内容')
      })
      .strict(),
    z
      .object({
        action: z.literal('observe').describe('观察动作'),
        page: browserUsePageOutputSchema.describe('当前页面信息'),
        actions: z.array(browserActionCandidateOutputSchema).describe('可见交互动作列表')
      })
      .strict(),
    z
      .object({
        action: z.literal('act').describe('执行动作'),
        page: browserUsePageOutputSchema.describe('当前页面信息'),
        success: z.boolean().describe('动作是否成功'),
        message: z.string().describe('执行结果说明'),
        actionDescription: z.string().describe('已执行动作描述'),
        actions: z.array(browserActionCandidateOutputSchema).optional().describe('后续可选动作')
      })
      .strict()
  ]),
  z
    .object({
      action: z.enum(['navigate', 'extract', 'observe', 'act']).optional().describe('失败前的动作'),
      page: browserUsePageOutputSchema.optional().describe('失败前的页面信息'),
      error: z.string().describe('错误信息')
    })
    .strict()
])
