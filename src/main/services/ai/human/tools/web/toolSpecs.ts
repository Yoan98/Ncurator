import type { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderBrowserUseModelResult,
  renderWebSearchModelResult
} from '../../shared/modelToolResultRenderers'
import { BROWSER_USE_SCHEMA, WEB_SEARCH_SCHEMA } from './toolSchemas'

const WEB_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  defaultResourceKey: 'web'
})

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
    description: '搜索或抓取网页正文。'
  },
  resolveExecutionMeta: WEB_EXECUTION_META,
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
    description: '操作内置浏览器页面。'
  },
  resolveExecutionMeta: (args) => ({
    mutability: String(args.action || '') === 'act' ? 'mutating' : 'read_only',
    resourceKey: String(args.url || 'embedded-browser')
  }),
  modelResult: { renderSuccess: renderBrowserUseModelResult }
}

export const WEB_TOOL_SPECS = [WEB_SEARCH_TOOL_SPEC, BROWSER_USE_TOOL_SPEC] as const
