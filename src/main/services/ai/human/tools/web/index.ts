import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject, JsonObject, JsonValue } from '../../../../../../shared/types'
import type {
  BrowserActionCandidate,
  BrowserUsePage,
  BrowserUseResult
} from '../../../types'
import type { WebSearchResult } from '../../../../webCrawler/types'
import { WebSourceService } from '../../../../web/WebSourceService'
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
  const statusCode = typeof details.statusCode === 'number' ? details.statusCode : undefined
  return {
    error: getErrorMessage(input.error),
    requestedUrl: details.requestedUrl || input.fallbackUrl,
    ...(details.finalUrl ? { finalUrl: details.finalUrl } : {}),
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
  description: candidate.description,
  ...(candidate.method ? { method: candidate.method } : {}),
  ...(candidate.arguments?.length ? { arguments: candidate.arguments } : {})
})

const normalizeBrowserUseOutput = (result: BrowserUseResult): JsonObject => {
  if ('error' in result) {
    return {
      ...(result.action ? { action: result.action } : {}),
      ...(result.page ? { page: toBrowserUsePageJson(result.page) } : {}),
      error: result.error
    }
  }
  switch (result.action) {
    case 'navigate':
      return { action: 'navigate', page: toBrowserUsePageJson(result.page) }
    case 'extract':
      return {
        action: 'extract',
        page: toBrowserUsePageJson(result.page),
        content: result.result.extracted
      }
    case 'observe':
      return {
        action: 'observe',
        page: toBrowserUsePageJson(result.page),
        actions: result.result.actions.map(toBrowserActionCandidateJson)
      }
    case 'act':
      return {
        action: 'act',
        page: toBrowserUsePageJson(result.page),
        success: result.result.success,
        message: result.result.message,
        actionDescription: result.result.actionDescription,
        ...(result.result.actions.length
          ? { actions: result.result.actions.map(toBrowserActionCandidateJson) }
          : {})
      }
  }
}

export const webToolFamily: ToolFamilyDefinition = {
  familyId: 'web',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })
    let automationBrowserTabPromise: Promise<{ id: string }> | null = null

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
                const result = await service.crawl({ url: crawlUrl, topic: crawlUrl })
                const payload = buildFetchOutput({ result })
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

            const instruction =
              args.action === 'navigate' ? '' : String(args.instruction || '').trim()
            try {
              automationBrowserTabPromise ||= service.ensureAutomationTab(ctx.sessionId)
              let browserTab: { id: string }
              try {
                browserTab = await automationBrowserTabPromise
              } catch (error) {
                automationBrowserTabPromise = null
                throw error
              }
              ctx.sendEvent({
                type: 'browser_panel_opened',
                runId,
                taskId,
                browserTabId: browserTab.id,
                createdAt: Date.now()
              })
              const llmConfig = await ctx.getLlmConfig()
              const result =
                args.action === 'navigate'
                  ? await service.run({
                      tabId: browserTab.id,
                      action: 'navigate',
                      url: args.url,
                      llmConfig
                    })
                  : await service.run({
                      tabId: browserTab.id,
                      action: args.action,
                      instruction,
                      llmConfig
                    })
              const payload = normalizeBrowserUseOutput(result)
              if ('error' in result) {
                session.fail(
                  result.error,
                  undefined,
                  buildToolResult({
                    toolName: BROWSER_USE_TOOL_SPEC.name,
                    ok: false,
                    data: payload
                  })
                )
                return payload
              }

              const ok = result.action !== 'act' || result.result.success
              if (ok) {
                session.succeed(
                  undefined,
                  buildToolResult({ toolName: BROWSER_USE_TOOL_SPEC.name, ok: true, data: payload })
                )
              } else {
                session.fail(
                  result.result.message,
                  undefined,
                  buildToolResult({
                    toolName: BROWSER_USE_TOOL_SPEC.name,
                    ok: false,
                    data: payload
                  })
                )
              }
              return payload
            } catch (error) {
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
