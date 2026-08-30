import { z } from 'zod/v4'

export const WEB_SEARCH_SCHEMA = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('search').describe('按关键词搜索公开网页'),
      query: z.string().min(1).describe('搜索关键词')
    })
    .strict(),
  z
    .object({
      type: z.literal('fetch').describe('抓取单个 URL 的正文'),
      url: z.string().min(1).describe('目标 URL')
    })
    .strict()
])

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
  WebSearchFetchFailureOutput,
  WebSearchFetchOutput,
  WebSearchLinkItem,
  WebSearchResultItem,
  WebSearchSearchOutput
} from './outputTypes'
