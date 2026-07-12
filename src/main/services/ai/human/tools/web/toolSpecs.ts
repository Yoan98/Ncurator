import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WEB_CRAWL_SCHEMA = z.object({
  url: z.string().min(1),
  topic: z.string().min(1)
})

export const WEB_SEARCH_SCHEMA = z.object({
  query: z.string().min(1)
})

export const BROWSER_USE_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('navigate'),
    url: z.string().min(1),
    instruction: z.string().optional()
  }),
  z.object({
    action: z.literal('extract'),
    instruction: z.string().min(1),
    url: z.string().min(1).optional()
  }),
  z.object({
    action: z.literal('observe'),
    instruction: z.string().min(1),
    url: z.string().min(1).optional()
  }),
  z.object({
    action: z.literal('act'),
    instruction: z.string().min(1),
    url: z.string().min(1).optional()
  })
])

export const WEB_CRAWL_OUTPUT_SCHEMA = z.union([
  z.object({
    requestedUrl: z.string(),
    finalUrl: z.string(),
    title: z.string().optional(),
    markdown: z.string(),
    links: z.object({
      internal: z.array(
        z.object({
          href: z.string(),
          text: z.string().optional(),
          title: z.string().optional(),
          intrinsicScore: z.number().optional(),
          contextualScore: z.number().optional(),
          totalScore: z.number().optional()
        })
      ),
      external: z.array(
        z.object({
          href: z.string(),
          text: z.string().optional(),
          title: z.string().optional(),
          intrinsicScore: z.number().optional(),
          contextualScore: z.number().optional(),
          totalScore: z.number().optional()
        })
      )
    }),
    publishedAt: z.string().optional()
  }),
  z.object({
    error: z.string(),
    requestedUrl: z.string().optional(),
    finalUrl: z.string().optional(),
    statusCode: z.number().int().optional()
  })
])

export const WEB_SEARCH_OUTPUT_SCHEMA = z.union([
  z.object({
    query: z.string(),
    results: z.array(
      z.object({
        rank: z.number().int(),
        title: z.string(),
        url: z.string(),
        snippet: z.string().optional()
      })
    )
  }),
  z.object({
    error: z.string(),
    query: z.string().optional()
  })
])

const browserUseBaseOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  summary: z.string().optional()
})

export const BROWSER_USE_OUTPUT_SCHEMA = z.union([
  browserUseBaseOutputSchema.extend({
    success: z.boolean(),
    message: z.string(),
    pageState: z.string().optional()
  }),
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
      '能力：抓取一个明确的公开网页 URL，并返回正文 markdown、请求前后 URL、发布时间和分组链接。\n结果：返回 requestedUrl/finalUrl/title/markdown/links，links 会包含 internal/external 分组和评分。\n边界：topic 只用于 links 评分，不用于正文裁剪；不执行全网搜索，不解析搜索结果页，不执行登录、点击、输入或验证码等浏览器交互。',
    whenToUse: '适用于已经有明确网页 URL，需要读取该网页正文内容的任务。',
    examples: [
      {
        goal: '读取一个公开网页正文',
        args: {
          url: 'https://example.com',
          topic: '这个页面和补贴申报条件的相关内容'
        }
      }
    ]
  },
  resolveExecutionMeta: WEB_EXECUTION_META
}

export const WEB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WEB_SEARCH_SCHEMA>,
  z.infer<typeof WEB_SEARCH_OUTPUT_SCHEMA>,
  'web_search',
  'web-browsing'
> = {
  name: 'web_search',
  familyId: 'web',
  skillIds: ['web-browsing'],
  requiresWorkspace: false,
  inputSchema: WEB_SEARCH_SCHEMA,
  outputSchema: WEB_SEARCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'web_search',
    description:
      '能力：根据关键词搜索公开网页，并返回候选网页的标题、URL 和摘要。\n结果：返回的是候选网页列表，不是网页正文证据；需要确认具体内容时，应继续使用 web_crawl 读取明确 URL。\n边界：只搜索公开网页，不读取网页正文，不执行登录、点击、输入或验证码等浏览器交互。',
    whenToUse: '适用于用户只给出问题或关键词、还没有明确网页 URL，但需要查找相关公开网页的任务。',
    examples: [
      {
        goal: '搜索最近 DeepSeek 融资相关公开网页',
        args: {
          query: '最近 DeepSeek 融资情况'
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
      '能力：操作应用的右侧内置浏览器，支持 navigate、extract、observe、act 四类网页操作。\n规则：只是打开 URL 必须使用 navigate；观察按钮、输入框和可点击元素等使用 observe；提取页面正文或结果等使用 extract；点击、输入、提交、选择等使用 act；\n结果：navigate 返回导航结果与页面状态；extract 返回页面内容；observe 返回可见动作；act 返回动作执行结果与页面状态。\n边界：extract、observe、act 使用页面 DOM 与浏览器上下文完成操作；',
    whenToUse: '适用于需要通过浏览器完成的任务。',
    examples: [
      {
        goal: '打开一个网页',
        args: {
          action: 'navigate',
          url: 'https://example.com'
        }
      },
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

export const WEB_TOOL_SPECS = [
  WEB_SEARCH_TOOL_SPEC,
  WEB_CRAWL_TOOL_SPEC,
  BROWSER_USE_TOOL_SPEC
] as const
