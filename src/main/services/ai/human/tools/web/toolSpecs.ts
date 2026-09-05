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
      '在内置浏览器中操作网页，支持页面导航、动作观察、动作执行、指令驱动执行、正文提取、页面滚动与截图。'
  },
  resolveExecutionMeta: (args) => ({
    mutability:
      String(args.action || '') === 'act' || String(args.action || '') === 'act_instruction'
        ? 'mutating'
        : 'read_only',
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
