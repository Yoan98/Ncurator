import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WEB_CRAWL_SCHEMA = z.object({
  url: z.string().min(1),
  topic: z.string().min(1).optional()
})

export const BROWSER_USE_SCHEMA = z.object({
  action: z.enum(['extract', 'observe', 'act']),
  instruction: z.string().min(1),
  url: z.string().min(1).optional()
})

export const WEB_CRAWL_OUTPUT_SCHEMA = z.union([
  z.object({
    finalUrl: z.string(),
    title: z.string().optional(),
    markdown: z.string(),
    links: z.array(
      z.object({
        href: z.string(),
        text: z.string().optional()
      })
    ),
    publishedAt: z.string().optional()
  }),
  z.object({
    error: z.string(),
    finalUrl: z.string().optional(),
    statusCode: z.number().int().optional()
  })
])

const browserUseBaseOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional()
})

export const BROWSER_USE_OUTPUT_SCHEMA = z.union([
  browserUseBaseOutputSchema.extend({
    content: z.string()
  }),
  browserUseBaseOutputSchema.extend({
    actions: z.array(
      z.object({
        description: z.string(),
        method: z.string().optional()
      })
    )
  }),
  browserUseBaseOutputSchema.extend({
    success: z.boolean(),
    message: z.string(),
    pageState: z.string().optional()
  }),
  z.object({
    error: z.string()
  })
])

const WEB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'web'
})

export const WEB_CRAWL_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WEB_CRAWL_SCHEMA>,
  z.infer<typeof WEB_CRAWL_OUTPUT_SCHEMA>,
  'web_crawl',
  'web-browsing'
> = {
  name: 'web_crawl',
  familyId: 'web',
  skillIds: ['web-browsing'],
  requiresWorkspace: false,
  inputSchema: WEB_CRAWL_SCHEMA,
  outputSchema: WEB_CRAWL_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'web_crawl',
    description:
      '能力：抓取公开网页，并返回当前选中的最相关页面的正文 markdown、标题、发布时间和可继续跟进的链接。\n结果：支持基于 topic 做链接排序，并在必要时少量自动跟进相关页面；因此 finalUrl 可能不同于输入 url，只要返回了 finalUrl/title/markdown，就表示已成功抓取到选中页面正文。\n边界：不执行登录、点击、输入或验证码等浏览器交互。',
    whenToUse: '适用于需要读取公开网页、基于页面内容继续判断下一步要抓取哪个链接的任务。',
    examples: [
      {
        goal: '读取一个公开网页，并围绕当前主题查找更相关的页面内容',
        args: {
          url: 'https://example.com',
          topic: '查询退费规则和到账时限'
        }
      }
    ]
  },
  resolveExecutionMeta: WEB_EXECUTION_META
}

export const BROWSER_USE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof BROWSER_USE_SCHEMA>,
  z.infer<typeof BROWSER_USE_OUTPUT_SCHEMA>,
  'browser_use',
  'web-browsing'
> = {
  name: 'browser_use',
  familyId: 'web',
  skillIds: ['web-browsing'],
  requiresWorkspace: false,
  inputSchema: BROWSER_USE_SCHEMA,
  outputSchema: BROWSER_USE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'browser_use',
    description:
      '能力：操作应用的右侧内置浏览器，支持 extract、observe、act 三类网页操作。\n结果：extract 返回页面内容；observe 返回可见动作；act 返回动作执行结果与页面状态。\n边界：使用页面 DOM 与浏览器上下文完成操作；首次使用会进入用户审核。',
    whenToUse: '适用于需要在网页界面中读取、观察或执行动作的任务。',
    examples: [
      {
        goal: '观察当前网页上可执行的搜索相关动作',
        args: {
          action: 'observe',
          instruction: '观察页面上与搜索有关的可执行动作'
        }
      }
    ]
  },
  resolveExecutionMeta: (args) => ({
    mutability: String(args.action || '') === 'act' ? 'mutating' : 'read_only',
    resourceKey: String(args.url || 'embedded-browser')
  })
}

export const WEB_TOOL_SPECS = [WEB_CRAWL_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
