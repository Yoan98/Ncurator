import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WEB_FETCH_SCHEMA = z.object({
  url: z.string().min(1)
})

export const BROWSER_USE_SCHEMA = z.object({
  action: z.enum(['extract', 'observe', 'act']),
  instruction: z.string().min(1),
  url: z.string().min(1).optional(),
  mode: z.enum(['dom', 'visual']).optional()
})

export const WEB_FETCH_OUTPUT_SCHEMA = z.union([
  z.object({
    url: z.string(),
    statusCode: z.number().int(),
    title: z.string().optional(),
    text: z.string()
  }),
  z.object({
    error: z.string(),
    url: z.string().optional(),
    statusCode: z.number().int().optional()
  })
])

const browserUseBaseOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  mode: z.enum(['dom', 'visual'])
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

export const WEB_FETCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WEB_FETCH_SCHEMA>,
  z.infer<typeof WEB_FETCH_OUTPUT_SCHEMA>,
  'web_fetch',
  'web-browsing'
> = {
  name: 'web_fetch',
  familyId: 'web',
  skillIds: ['web-browsing'],
  requiresWorkspace: false,
  inputSchema: WEB_FETCH_SCHEMA,
  outputSchema: WEB_FETCH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'web_fetch',
    description:
      '能力：通过程序请求抓取 http/https 网页并抽取正文文本。\n结果：返回最终 URL、HTTP 状态、标题和正文文本。\n边界：不操作页面界面，不执行浏览器交互。',
    whenToUse: '适用于需要快速读取公开网页正文的任务。',
    examples: [
      {
        goal: '读取一个公开网页的正文',
        args: {
          url: 'https://example.com'
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
      '能力：操作应用的右侧内置浏览器，支持 extract、observe、act 三类网页操作。\n结果：extract 返回页面内容；observe 返回可见动作；act 返回动作执行结果与页面状态。\n边界：mode 默认为 dom；visual 使用当前页面截图和当前模型视觉能力；首次使用会进入用户审核。',
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

export const WEB_TOOL_SPECS = [WEB_FETCH_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
