import type { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { readStringArg } from '../utils/toolSpecUtils'
import {
  renderBrowserUseModelError,
  renderBrowserUseModelResult,
  renderWebSearchModelResult
} from '../../shared/modelToolResultRenderers'
import { BROWSER_USE_SCHEMA, WEB_SEARCH_SCHEMA } from './toolSchemas'

export const WEB_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WEB_SEARCH_SCHEMA>,
  'web_search',
  'web-browsing'
> = {
  name: 'web_search',
  familyId: 'web',
  skillIds: ['web-browsing'],
  inputSchema: WEB_SEARCH_SCHEMA,
  promptSpec: {
    name: 'web_search',
    description: '搜索公开网页，或抓取单个 URL 的正文。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: 'read_only',
    resourceKey:
      args.type === 'fetch'
        ? readStringArg(args, 'url') || 'web-fetch'
        : readStringArg(args, 'query') || 'web-search'
  }),
  modelResult: { renderSuccess: renderWebSearchModelResult }
}

export const BROWSER_USE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof BROWSER_USE_SCHEMA>,
  'browser_use',
  'web-browsing'
> = {
  name: 'browser_use',
  familyId: 'web',
  skillIds: ['web-browsing'],
  inputSchema: BROWSER_USE_SCHEMA,
  promptSpec: {
    name: 'browser_use',
    description:
      '操作内置浏览器：navigate 打开页面（可新建或指定 tab），list_tabs 查看标签，observe 列出可交互动作，act 按 actionId 执行单个动作，extract 提取内容，screenshot 全页截图。observe/extract/act/screenshot 必须传 tabId；act 只能使用此前 observe 返回的 actionId。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: String(args.action || '') === 'act' ? 'mutating' : 'read_only',
    resourceKey:
      (typeof args.tabId === 'string' && args.tabId.trim()) ||
      (typeof args.url === 'string' && args.url.trim()) ||
      'embedded-browser'
  }),
  modelResult: {
    renderSuccess: renderBrowserUseModelResult,
    renderError: renderBrowserUseModelError
  }
}

export const WEB_TOOL_SPECS = [WEB_SEARCH_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
