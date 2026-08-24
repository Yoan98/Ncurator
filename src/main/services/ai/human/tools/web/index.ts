import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject, JsonValue } from '../../../../../../shared/types'
import { WebSourceService } from '../../../../web/WebSourceService'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { BROWSER_USE_TOOL_SPEC, WEB_SEARCH_TOOL_SPEC } from './toolSpecs'

const webSourceService = new WebSourceService()

const getErrorMessage = (error: Error): string => error.message || String(error)

type WebCrawlerFailureDetails = Error & {
  requestedUrl?: string
  finalUrl?: string
  statusCode?: number
}

const renderLinkForAi = (link: {
  href: string
  text?: string
  title?: string
  intrinsicScore?: number
  contextualScore?: number
  totalScore?: number
}) => ({
  href: link.href,
  ...(link.text ? { text: link.text } : {}),
  ...(link.title ? { title: link.title } : {}),
  ...(typeof link.intrinsicScore === 'number' ? { intrinsicScore: link.intrinsicScore } : {}),
  ...(typeof link.contextualScore === 'number' ? { contextualScore: link.contextualScore } : {}),
  ...(typeof link.totalScore === 'number' ? { totalScore: link.totalScore } : {})
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

const buildCrawlPayload = (input: {
  result: {
    requestedUrl: string
    finalUrl: string
    title?: string
    markdown: string
    links: { internal: Parameters<typeof renderLinkForAi>[0][]; external: Parameters<typeof renderLinkForAi>[0][] }
    publishedAt?: string
  }
}) => ({
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

const buildCrawlFailurePayload = (input: {
  error: Error
  fallbackUrl: string
}): {
  error: string
  requestedUrl: string
  finalUrl: string
  statusCode?: number
} => {
  const details = input.error as WebCrawlerFailureDetails
  const statusCode = typeof details.statusCode === 'number' ? details.statusCode : undefined
  return {
    error: getErrorMessage(input.error),
    requestedUrl: details.requestedUrl || input.fallbackUrl,
    finalUrl: details.finalUrl || input.fallbackUrl,
    ...(statusCode !== undefined ? { statusCode } : {})
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

            const rawQuery = String(args.query || '').trim()
            const rawUrl = String(args.url || '').trim()

            if (rawUrl) {
              let crawlUrl: string
              try {
                crawlUrl = webSourceService.normalizeUrl(rawUrl).url
              } catch (error) {
                const payload = {
                  error: getErrorMessage(error instanceof Error ? error : new Error(String(error))),
                  requestedUrl: rawUrl
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
                const payload = buildCrawlPayload({ result })
                session.succeed(
                  undefined,
                  buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
                )
                return payload
              } catch (error) {
                const payload = buildCrawlFailurePayload({
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

            let searchItems: Array<{ rank: number; title: string; url: string; snippet?: string }>
            try {
              searchItems = (await service.search({ query: rawQuery })).results
            } catch (error) {
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error))),
                requestedUrl: rawQuery
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

            if (searchItems.length === 0) {
              const payload = { error: 'web_search 没有找到相关结果', requestedUrl: rawQuery }
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

            const payload = await Promise.all(
              searchItems.map(async (item) => {
                const baseItem = {
                  rank: item.rank,
                  title: item.title,
                  url: item.url,
                  ...(item.snippet ? { snippet: item.snippet } : {})
                }
                let itemCrawlUrl: string
                try {
                  itemCrawlUrl = webSourceService.normalizeUrl(item.url).url
                } catch {
                  return { ...baseItem, error: '无法解析网页地址' }
                }
                try {
                  const result = await service.crawl({ url: itemCrawlUrl, topic: rawQuery })
                  return { ...baseItem, ...buildCrawlPayload({ result }) }
                } catch (error) {
                  const details = error as WebCrawlerFailureDetails
                  return {
                    ...baseItem,
                    requestedUrl: details.requestedUrl || itemCrawlUrl,
                    ...(details.finalUrl ? { finalUrl: details.finalUrl } : {}),
                    error: getErrorMessage(error instanceof Error ? error : new Error(String(error)))
                  }
                }
              })
            )

            session.succeed(
              undefined,
              buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
            )
            return payload
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

            const instruction = String(args.instruction || '').trim()
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
                      instruction: instruction || undefined,
                      llmConfig
                    })
                  : await service.run({
                      tabId: browserTab.id,
                      action: args.action,
                      instruction,
                      llmConfig
                    })
              const payload = { ...result }
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
