import type { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderBrowserUseModelResult,
  renderWebSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  BROWSER_USE_OUTPUT_SCHEMA,
  BROWSER_USE_SCHEMA,
  WEB_SEARCH_OUTPUT_SCHEMA,
  WEB_SEARCH_SCHEMA
} from './toolSchemas'

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
      '搜索或抓取网页。传 query 时按关键词搜索并 crawl 每条结果；传 url 时直接 crawl 该页。统一返回 items 数组，每项含 requestedUrl、finalUrl、title、markdown、links 与 publishedAt，或 error。'
  },
  resolveExecutionMeta: WEB_EXECUTION_META,
  modelResult: { renderSuccess: renderWebSearchModelResult }
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
      '操作浏览器；action=navigate 打开 URL，action=extract 提取页面内容为 content，action=observe 返回可见交互动作，action=act 执行点击、输入、提交或选择。extract/observe/act 只作用于当前页面；需要切换页面时先 navigate。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: String(args.action || '') === 'act' ? 'mutating' : 'read_only',
    resourceKey: String(args.url || 'embedded-browser')
  }),
  modelResult: { renderSuccess: renderBrowserUseModelResult }
}

export const WEB_TOOL_SPECS = [WEB_SEARCH_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
