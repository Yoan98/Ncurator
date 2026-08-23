import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WEB_SEARCH_SCHEMA = z
  .object({
    query: z.string().min(1).optional(),
    url: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.query) !== Boolean(value.url), {
    message: 'query 与 url 必须二选一'
  })

export const BROWSER_USE_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('navigate'),
    url: z.string().min(1),
    instruction: z.string().optional()
  }),
  z.object({
    action: z.literal('extract'),
    instruction: z.string().min(1)
  }),
  z.object({
    action: z.literal('observe'),
    instruction: z.string().min(1)
  }),
  z.object({
    action: z.literal('act'),
    instruction: z.string().min(1)
  })
])

export const WEB_SEARCH_OUTPUT_SCHEMA = z.union([
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

const browserUsePageOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional()
})

const browserActionCandidateOutputSchema = z.object({
  description: z.string(),
  method: z.string().optional(),
  arguments: z.array(z.string()).optional()
})

export const BROWSER_USE_OUTPUT_SCHEMA = z.union([
  z.discriminatedUnion('action', [
    z.object({
      action: z.literal('navigate'),
      page: browserUsePageOutputSchema,
      result: z.null()
    }),
    z.object({
      action: z.literal('extract'),
      page: browserUsePageOutputSchema,
      result: z.object({
        extracted: z.string()
      })
    }),
    z.object({
      action: z.literal('observe'),
      page: browserUsePageOutputSchema,
      result: z.object({
        actions: z.array(browserActionCandidateOutputSchema)
      })
    }),
    z.object({
      action: z.literal('act'),
      page: browserUsePageOutputSchema,
      result: z.object({
        success: z.boolean(),
        message: z.string(),
        actionDescription: z.string(),
        actions: z.array(browserActionCandidateOutputSchema)
      })
    })
  ]),
  z.object({
    action: z.enum(['navigate', 'extract', 'observe', 'act']).optional(),
    page: browserUsePageOutputSchema.optional(),
    error: z.string()
  })
])

const WEB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'web'
})

export const WEB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WEB_SEARCH_SCHEMA>,
  z.infer<typeof WEB_SEARCH_OUTPUT_SCHEMA>,
  'web_search',
  'web-browsing'
> = {
  name: 'web_search',
  familyId: 'web',
  skillIds: ['web-browsing'],
  inputSchema: WEB_SEARCH_SCHEMA,
  outputSchema: WEB_SEARCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'web_search',
    description:
      '搜索网页内容。传 query 时按关键词搜索并读取最相关网页内容；传 url 时直接读取该指定网页内容。返回 requestedUrl、finalUrl、title、markdown、分组评分后的 links 与发布时间。'
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
  inputSchema: BROWSER_USE_SCHEMA,
  outputSchema: BROWSER_USE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'browser_use',
    description:
      '操作浏览器；action=navigate 打开 URL，action=extract 提取页面内容，action=observe 返回可见的交互动作，action=act 执行点击、输入、提交或选择。extract/observe/act 只作用于当前页面、不会跳转；需要切换页面时先调用 navigate。返回当前页面信息，以及对应 action 的提取内容、可见动作或执行结果。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: String(args.action || '') === 'act' ? 'mutating' : 'read_only',
    resourceKey: String(args.url || 'embedded-browser')
  })
}

export const WEB_TOOL_SPECS = [WEB_SEARCH_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
