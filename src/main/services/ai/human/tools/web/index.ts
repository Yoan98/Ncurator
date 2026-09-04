import { tool } from '@langchain/core/tools'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AiToolCallResult, IpcJsonObject, JsonObject, JsonValue } from '../../../../../../shared/types'
import type {
  BrowserActionCandidate,
  BrowserStagehandAction,
  BrowserUsePage,
  BrowserUseResult
} from '../../../types'
import type { WebSearchResult } from '../../../../webCrawler/types'
import { WebSourceService } from '../../../../web/WebSourceService'
import { ensureWorkspaceAssetBucket } from '../../../../assets/WorkspaceAssetService'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { BROWSER_USE_TOOL_SPEC, WEB_SEARCH_TOOL_SPEC } from './toolSpecs'
import type {
  WebSearchFetchFailureOutput,
  WebSearchFetchOutput,
  WebSearchLinkItem,
  WebSearchSearchOutput
} from './outputTypes'
import {
  fetchHttpPage,
  isHttpPageFetchError,
  isLoopbackHttpUrl,
  shouldBypassCrawlerForLoopbackFetch
} from './httpPageFetch'
import { isCancelledError } from '../../../utils/runFailure'

const WEB_SEARCH_FETCH_TIMEOUT_MS = 70_000
const WEB_SEARCH_HTTP_MARKDOWN_MIN_CHARS = 200
const BROWSER_SCREENSHOT_BUCKET = 'browser-screenshots'

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const webSourceService = new WebSourceService()

const getErrorMessage = (error: Error): string => error.message || String(error)

type WebCrawlerFailureDetails = Error & {
  requestedUrl?: string
  finalUrl?: string
  statusCode?: number
}

const renderLinkForAi = (link: WebSearchLinkItem): WebSearchLinkItem => ({
  href: link.href,
  ...(link.text ? { text: link.text } : {}),
  ...(link.title ? { title: link.title } : {})
})

const buildToolResult = (input: {
  toolName: string
  ok: boolean
  data: JsonValue
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data
})

const buildFetchOutput = (input: {
  result: {
    requestedUrl: string
    finalUrl: string
    title?: string
    markdown: string
    links: { internal: WebSearchLinkItem[]; external: WebSearchLinkItem[] }
    publishedAt?: string
  }
}): WebSearchFetchOutput => ({
  requestedUrl: input.result.requestedUrl,
  finalUrl: input.result.finalUrl,
  ...(input.result.title ? { title: input.result.title } : {}),
  markdown: input.result.markdown,
  links: {
    internal: input.result.links.internal.map(renderLinkForAi),
    external: input.result.links.external.map(renderLinkForAi)
  },
  ...(input.result.publishedAt ? { publishedAt: input.result.publishedAt } : {})
})

const buildFetchFailureOutput = (input: {
  error: Error
  fallbackUrl: string
}): WebSearchFetchFailureOutput => {
  const details = input.error as WebCrawlerFailureDetails
  const statusCode =
    typeof details.statusCode === 'number'
      ? details.statusCode
      : isHttpPageFetchError(input.error)
        ? input.error.statusCode
        : undefined
  const requestedUrl =
    details.requestedUrl
    || (isHttpPageFetchError(input.error) ? input.error.requestedUrl : undefined)
    || input.fallbackUrl
  const finalUrl =
    details.finalUrl || (isHttpPageFetchError(input.error) ? input.error.finalUrl : undefined)
  return {
    error: getErrorMessage(input.error),
    requestedUrl,
    ...(finalUrl ? { finalUrl } : {}),
    ...(statusCode !== undefined ? { statusCode } : {})
  }
}

const buildSearchOutput = (searchResult: WebSearchResult): WebSearchSearchOutput => ({
  query: searchResult.query,
  results: searchResult.results.map((item) => ({
    rank: item.rank,
    title: item.title,
    url: item.url,
    ...(item.snippet ? { snippet: item.snippet } : {})
  }))
})

const toBrowserUsePageJson = (page: BrowserUsePage): JsonObject => ({
  url: page.url,
  ...(page.title ? { title: page.title } : {})
})

const toBrowserActionCandidateJson = (candidate: BrowserActionCandidate): JsonObject => ({
  actionId: candidate.actionId,
  method: candidate.method,
  description: candidate.description,
  arguments: candidate.arguments,
  selector: candidate.selector
})

const normalizeBrowserUseOutput = (
  result: BrowserUseResult,
  observeActions?: BrowserActionCandidate[]
): JsonObject => {
  if ('error' in result) {
    return {
      ...(result.action ? { action: result.action } : {}),
      ...(result.tabId ? { tabId: result.tabId } : {}),
      ...(result.page ? { page: toBrowserUsePageJson(result.page) } : {}),
      error: result.error
    }
  }
  switch (result.action) {
    case 'navigate':
      return {
        action: 'navigate',
        tabId: result.tabId,
        page: toBrowserUsePageJson(result.page)
      }
    case 'list_tabs':
      return {
        action: 'list_tabs',
        tabs: result.tabs.map((tab) => ({
          tabId: tab.tabId,
          title: tab.title,
          url: tab.url,
          active: tab.active
        }))
      }
    case 'extract':
      return {
        action: 'extract',
        tabId: result.tabId,
        page: toBrowserUsePageJson(result.page),
        content: result.result.extracted
      }
    case 'observe':
      return {
        action: 'observe',
        tabId: result.tabId,
        page: toBrowserUsePageJson(result.page),
        actions: (observeActions || []).map(toBrowserActionCandidateJson)
      }
    case 'act': {
      const actBase = {
        action: 'act' as const,
        tabId: result.tabId,
        page: toBrowserUsePageJson(result.page),
        message: result.result.message,
        actionDescription: result.result.actionDescription,
        executed: toBrowserActionCandidateJson(result.result.executed)
      }
      if (!result.result.success) {
        return { ...actBase, error: result.result.message }
      }
      return actBase
    }
    case 'screenshot':
      return {
        action: 'screenshot',
        tabId: result.tabId,
        page: toBrowserUsePageJson(result.page),
        path: result.result.path
      }
  }
}

type CachedObserveAction = {
  tabId: string
  action: BrowserStagehandAction
}

export const webToolFamily: ToolFamilyDefinition = {
  familyId: 'web',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })
    const observeActionCache = new Map<string, CachedObserveAction>()

    const emitBrowserPanelOpened = (browserTabId: string): void => {
      ctx.sendEvent({
        type: 'browser_panel_opened',
        runId,
        taskId,
        browserTabId,
        createdAt: Date.now()
      })
    }

    const finishBrowserUse = (input: {
      session: {
        succeed: (message: undefined, result: AiToolCallResult) => void
        fail: (error: string, message: undefined, result: AiToolCallResult) => void
      }
      payload: JsonObject
    }): JsonObject => {
      const errorText =
        typeof input.payload.error === 'string' && input.payload.error.trim()
          ? input.payload.error.trim()
          : undefined
      if (errorText) {
        input.session.fail(
          errorText,
          undefined,
          buildToolResult({
            toolName: BROWSER_USE_TOOL_SPEC.name,
            ok: false,
            data: input.payload
          })
        )
        return input.payload
      }
      input.session.succeed(
        undefined,
        buildToolResult({ toolName: BROWSER_USE_TOOL_SPEC.name, ok: true, data: input.payload })
      )
      return input.payload
    }

    const webSearch = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: WEB_SEARCH_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const service = ctx.webCrawlerService
            if (!service) {
              const payload = { error: 'web_search service unavailable' }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({
                  toolName: WEB_SEARCH_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
              )
              return payload
            }

            if (args.type === 'fetch') {
              const rawUrl = String(args.url || '').trim()
              let crawlUrl: string
              try {
                crawlUrl = webSourceService.normalizeUrl(rawUrl).url
              } catch (error) {
                const payload = {
                  requestedUrl: rawUrl,
                  error: getErrorMessage(error instanceof Error ? error : new Error(String(error)))
                }
                session.fail(
                  payload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_SEARCH_TOOL_SPEC.name,
                    ok: false,
                    data: payload
                  })
                )
                return payload
              }
              try {
                const crawlPage = async (): Promise<WebSearchFetchOutput> =>
                  buildFetchOutput({
                    result: await service.crawl({ url: crawlUrl, topic: crawlUrl })
                  })

                const tryHttpPage = async (): Promise<WebSearchFetchOutput | null> => {
                  try {
                    const httpResult = await fetchHttpPage(crawlUrl)
                    return httpResult.markdown.length > 0 ? httpResult : null
                  } catch (error) {
                    if (isHttpPageFetchError(error)) {
                      throw error
                    }
                    return null
                  }
                }

                let payload: WebSearchFetchOutput
                if (shouldBypassCrawlerForLoopbackFetch() && isLoopbackHttpUrl(crawlUrl)) {
                  const httpOnly = await tryHttpPage()
                  if (!httpOnly) {
                    throw new Error('网页正文为空')
                  }
                  payload = httpOnly
                } else {
                  const httpResult = await tryHttpPage()
                  if (httpResult && httpResult.markdown.length >= WEB_SEARCH_HTTP_MARKDOWN_MIN_CHARS) {
                    payload = httpResult
                  } else {
                    try {
                      payload = await withTimeout(
                        crawlPage(),
                        WEB_SEARCH_FETCH_TIMEOUT_MS,
                        'web_search fetch timed out'
                      )
                    } catch (crawlError) {
                      if (httpResult) {
                        payload = httpResult
                      } else {
                        throw crawlError
                      }
                    }
                  }
                }
                session.succeed(
                  undefined,
                  buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
                )
                return payload
              } catch (error) {
                const payload = buildFetchFailureOutput({
                  error: error instanceof Error ? error : new Error(String(error)),
                  fallbackUrl: crawlUrl
                })
                session.fail(
                  payload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_SEARCH_TOOL_SPEC.name,
                    ok: false,
                    data: payload
                })
                )
                return payload
              }
            }

            const rawQuery = String(args.query || '').trim()
            try {
              const searchResult = await service.search({ query: rawQuery })
              if (searchResult.results.length === 0) {
                const payload = { error: 'web_search 没有找到相关结果' }
                session.fail(
                  payload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_SEARCH_TOOL_SPEC.name,
                    ok: false,
                    data: payload
                  })
                )
                return payload
              }
              const payload = buildSearchOutput(searchResult)
              session.succeed(
                undefined,
                buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
              )
              return payload
            } catch (error) {
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error)))
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({
                  toolName: WEB_SEARCH_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
              )
              return payload
            }
          }
        }),
      {
        name: WEB_SEARCH_TOOL_SPEC.name,
        description: WEB_SEARCH_TOOL_SPEC.promptSpec.description,
        schema: WEB_SEARCH_TOOL_SPEC.inputSchema
      }
    )

    const browserUse = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: BROWSER_USE_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const service = ctx.browserUseService
            if (!service) {
              const payload = { error: 'browser_use service unavailable' }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({
                  toolName: BROWSER_USE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
              )
              return payload
            }

            try {
              const llmConfig = await ctx.getLlmConfig()
              const ownerId = ctx.sessionId
              const abortSignal = ctx.abortSignal
              let result: BrowserUseResult
              let observeActions: BrowserActionCandidate[] | undefined

              if (args.action === 'list_tabs') {
                result = await service.run({ action: 'list_tabs', ownerId, llmConfig, abortSignal })
              } else if (args.action === 'navigate') {
                const tabIdArg =
                  typeof args.tabId === 'string' && args.tabId.trim() ? args.tabId.trim() : undefined
                result = await service.run({
                  action: 'navigate',
                  ownerId,
                  url: String(args.url || '').trim(),
                  ...(tabIdArg ? { tabId: tabIdArg } : {}),
                  llmConfig,
                  abortSignal
                })
                if (!('error' in result) && result.action === 'navigate') {
                  emitBrowserPanelOpened(result.tabId)
                }
              } else if (args.action === 'observe') {
                const tabId = String(args.tabId || '').trim()
                emitBrowserPanelOpened(tabId)
                result = await service.run({
                  action: 'observe',
                  tabId,
                  instruction: String(args.instruction || '').trim(),
                  llmConfig,
                  abortSignal
                })
                if (!('error' in result) && result.action === 'observe') {
                  observeActions = result.result.actions.map((action) => {
                    const actionId = `obs_${randomUUID().replaceAll('-', '').slice(0, 12)}`
                    observeActionCache.set(actionId, { tabId, action })
                    return {
                      actionId,
                      description: action.description,
                      method: action.method,
                      arguments: action.arguments,
                      selector: action.selector
                    }
                  })
                }
              } else if (args.action === 'act') {
                const tabId = String(args.tabId || '').trim()
                const actionId = String(args.actionId || '').trim()
                emitBrowserPanelOpened(tabId)
                const cached = observeActionCache.get(actionId)
                if (!cached) {
                  return finishBrowserUse({
                    session,
                    payload: {
                      action: 'act',
                      tabId,
                      error: `未知 actionId：${actionId}。请先 observe 获取候选动作后再 act。`
                    }
                  })
                }
                if (cached.tabId !== tabId) {
                  return finishBrowserUse({
                    session,
                    payload: {
                      action: 'act',
                      tabId,
                      error: `actionId ${actionId} 属于 tab ${cached.tabId}，与请求的 tabId ${tabId} 不一致。`
                    }
                  })
                }
                result = await service.run({
                  action: 'act',
                  tabId,
                  actionId,
                  stagehandAction: cached.action,
                  llmConfig,
                  abortSignal
                })
              } else if (args.action === 'extract') {
                const tabId = String(args.tabId || '').trim()
                emitBrowserPanelOpened(tabId)
                result = await service.run({
                  action: 'extract',
                  tabId,
                  instruction: String(args.instruction || '').trim(),
                  llmConfig,
                  abortSignal
                })
              } else if (args.action === 'screenshot') {
                const tabId = String(args.tabId || '').trim()
                emitBrowserPanelOpened(tabId)
                const workspaceRoot = ctx.workspace?.rootPath
                if (!workspaceRoot) {
                  return finishBrowserUse({
                    session,
                    payload: {
                      action: 'screenshot',
                      tabId,
                      error: 'screenshot 需要已绑定工作区'
                    }
                  })
                }
                const bucketDir = await ensureWorkspaceAssetBucket(
                  workspaceRoot,
                  BROWSER_SCREENSHOT_BUCKET
                )
                const screenshotPath = path.join(
                  bucketDir,
                  `browser-screenshot-${randomUUID()}.png`
                )
                result = await service.run({
                  action: 'screenshot',
                  tabId,
                  screenshotPath,
                  llmConfig,
                  abortSignal
                })
              } else {
                const unknownAction =
                  typeof args === 'object' && args && 'action' in args
                    ? String((args as { action?: unknown }).action)
                    : 'unknown'
                return finishBrowserUse({
                  session,
                  payload: { error: `unsupported browser_use action: ${unknownAction}` }
                })
              }

              return finishBrowserUse({
                session,
                payload: normalizeBrowserUseOutput(result, observeActions)
              })
            } catch (error) {
              if (isCancelledError(error)) throw error
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error)))
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({
                  toolName: BROWSER_USE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
              )
              return payload
            }
          }
        }),
      {
        name: BROWSER_USE_TOOL_SPEC.name,
        description: BROWSER_USE_TOOL_SPEC.promptSpec.description,
        schema: BROWSER_USE_TOOL_SPEC.inputSchema
      }
    )

    return [webSearch, browserUse]
  }
}
