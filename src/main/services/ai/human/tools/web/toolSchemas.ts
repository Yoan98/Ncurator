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
      url: z.string().min(1).describe('目标 URL')
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

export type {
  BrowserActionCandidate,
  BrowserUseActOutput,
  BrowserUseErrorOutput,
  BrowserUseExtractOutput,
  BrowserUseNavigateOutput,
  BrowserUseObserveOutput,
  BrowserUseOutput,
  BrowserUsePage,
  WebSearchItem,
  WebSearchLinkItem,
  WebSearchOutput
} from './outputTypes'
