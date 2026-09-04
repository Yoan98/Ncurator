import { z } from 'zod/v4'

export const WEB_SEARCH_SCHEMA = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('search').describe('按搜索查询检索公开网页'),
      query: z.string().min(1).describe('查询语句')
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
      action: z.literal('navigate').describe('打开 URL；不传 tabId 则新建标签，传了则在指定标签导航'),
      url: z.string().min(1).describe('目标 URL'),
      tabId: z.string().min(1).optional().describe('已有浏览器标签 ID；省略则新建标签')
    })
    .strict(),
  z
    .object({
      action: z.literal('list_tabs').describe('列出当前会话的浏览器标签')
    })
    .strict(),
  z
    .object({
      action: z.literal('extract').describe('提取当前页面内容'),
      tabId: z.string().min(1).describe('目标浏览器标签 ID'),
      instruction: z.string().min(1).describe('提取目标或范围说明')
    })
    .strict(),
  z
    .object({
      action: z.literal('observe').describe('列出当前页面可见交互动作，供后续 act 使用'),
      tabId: z.string().min(1).describe('目标浏览器标签 ID'),
      instruction: z.string().min(1).describe('观察目标说明')
    })
    .strict(),
  z
    .object({
      action: z.literal('act').describe('执行此前 observe 返回的单个动作'),
      tabId: z.string().min(1).describe('目标浏览器标签 ID'),
      actionId: z.string().min(1).describe('observe 返回的 actionId')
    })
    .strict(),
  z
    .object({
      action: z.literal('screenshot').describe('截取当前标签页全页截图并保存为工作区资产文件'),
      tabId: z.string().min(1).describe('目标浏览器标签 ID')
    })
    .strict()
])

export type {
  BrowserActionCandidate,
  BrowserUseActOutput,
  BrowserUseErrorOutput,
  BrowserUseExtractOutput,
  BrowserUseListTabsOutput,
  BrowserUseNavigateOutput,
  BrowserUseObserveOutput,
  BrowserUseOutput,
  BrowserUsePage,
  BrowserUseScreenshotOutput,
  BrowserUseTabItem,
  WebSearchFetchFailureOutput,
  WebSearchFetchOutput,
  WebSearchLinkItem,
  WebSearchResultItem,
  WebSearchSearchOutput
} from './outputTypes'
