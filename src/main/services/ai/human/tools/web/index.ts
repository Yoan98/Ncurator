import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject, JsonValue } from '../../../../../../shared/types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import { WebSourceService } from '../../../../web/WebSourceService'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { checkToolResultSize } from '../utils/resultSizeGuard'
import type { ToolFamilyDefinition } from '../types'
import { BROWSER_USE_TOOL_SPEC, WEB_CRAWL_TOOL_SPEC, WEB_SEARCH_TOOL_SPEC } from './toolSpecs'

const webSourceService = new WebSourceService()

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
  data: input.data,
  diagnostic:
    input.ok || !isObjectRecord(input.data)
      ? undefined
      : typeof input.data.error === 'string' && input.data.error.trim()
        ? { message: input.data.error.trim() }
        : undefined
})

export const webToolFamily: ToolFamilyDefinition = {
  familyId: 'web',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })

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

            const query = String(args.query || '').trim()
            try {
              const result = await service.search({ query })
              const payload = {
                query: result.query,
                results: result.results
              }
              const sizeCheck = checkToolResultSize({
                toolName: WEB_SEARCH_TOOL_SPEC.name,
                value: payload,
                modelContextWindowTokens:
                  ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
                  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
              })
              if (sizeCheck.tooLarge) {
                const tooLargePayload = {
                  error: 'web_search result too large',
                  query: result.query,
                  reason: 'result_too_large',
                  estimatedTokens: sizeCheck.estimatedTokens,
                  limit: sizeCheck.limit,
                  ...(sizeCheck.decisionHint ? { decisionHint: sizeCheck.decisionHint } : {})
                }
                session.fail(
                  tooLargePayload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_SEARCH_TOOL_SPEC.name,
                    ok: false,
                    data: tooLargePayload
                  })
                )
                return tooLargePayload
              }

              session.succeed(
                undefined,
                buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
              )
              return payload
            } catch (error) {
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error))),
                query
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({ toolName: WEB_SEARCH_TOOL_SPEC.name, ok: false, data: payload })
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

    const webCrawl = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: WEB_CRAWL_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const service = ctx.webCrawlerService
            if (!service) {
              const payload = { error: 'web_crawl service unavailable' }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({
                  toolName: WEB_CRAWL_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
              )
              return payload
            }
            const rawUrl = String(args.url || '').trim()
            let normalizedUrl = rawUrl
            try {
              normalizedUrl = webSourceService.normalizeUrl(rawUrl).url
            } catch (error) {
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error))),
                url: rawUrl
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({ toolName: WEB_CRAWL_TOOL_SPEC.name, ok: false, data: payload })
              )
              return payload
            }

            try {
              const result = await service.crawl({
                url: normalizedUrl,
                topic: String(args.topic || '').trim()
              })
              const payload = {
                requestedUrl: result.requestedUrl,
                finalUrl: result.finalUrl,
                ...(result.title ? { title: result.title } : {}),
                markdown: result.markdown,
                links: {
                  internal: result.links.internal.map(renderLinkForAi),
                  external: result.links.external.map(renderLinkForAi)
                },
                ...(result.publishedAt ? { publishedAt: result.publishedAt } : {})
              }
              const sizeCheck = checkToolResultSize({
                toolName: WEB_CRAWL_TOOL_SPEC.name,
                value: payload,
                modelContextWindowTokens:
                  ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
                  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
              })
              if (sizeCheck.tooLarge) {
                const tooLargePayload = {
                  error: 'web_crawl result too large',
                  requestedUrl: result.requestedUrl,
                  finalUrl: result.finalUrl,
                  reason: 'result_too_large',
                  estimatedTokens: sizeCheck.estimatedTokens,
                  limit: sizeCheck.limit,
                  ...(sizeCheck.decisionHint ? { decisionHint: sizeCheck.decisionHint } : {})
                }
                session.fail(
                  tooLargePayload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_CRAWL_TOOL_SPEC.name,
                    ok: false,
                    data: tooLargePayload
                  })
                )
                return tooLargePayload
              }

              session.succeed(
                undefined,
                buildToolResult({ toolName: WEB_CRAWL_TOOL_SPEC.name, ok: true, data: payload })
              )
              return payload
            } catch (error) {
              const resolvedError: WebCrawlerFailureDetails =
                error instanceof Error
                  ? Object.assign(error, {
                      requestedUrl:
                        typeof (error as WebCrawlerFailureDetails).requestedUrl === 'string'
                          ? (error as WebCrawlerFailureDetails).requestedUrl
                          : undefined,
                      finalUrl:
                        typeof (error as WebCrawlerFailureDetails).finalUrl === 'string'
                          ? (error as WebCrawlerFailureDetails).finalUrl
                          : undefined,
                      statusCode:
                        typeof (error as WebCrawlerFailureDetails).statusCode === 'number'
                          ? (error as WebCrawlerFailureDetails).statusCode
                          : undefined
                    })
                  : new Error(String(error))
              const payload = {
                error: getErrorMessage(resolvedError),
                requestedUrl: resolvedError.requestedUrl || normalizedUrl,
                finalUrl: resolvedError.finalUrl || normalizedUrl,
                ...(typeof resolvedError.statusCode === 'number'
                  ? { statusCode: resolvedError.statusCode }
                  : {})
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({ toolName: WEB_CRAWL_TOOL_SPEC.name, ok: false, data: payload })
              )
              return payload
            }
          }
        }),
      {
        name: WEB_CRAWL_TOOL_SPEC.name,
        description: WEB_CRAWL_TOOL_SPEC.promptSpec.description,
        schema: WEB_CRAWL_TOOL_SPEC.inputSchema
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

            const action = args.action
            const instruction = String(args.instruction || '').trim()
            const url = typeof args.url === 'string' ? args.url.trim() : undefined
            try {
              const browserTab = await service.ensureAutomationTab(ctx.sessionId)
              ctx.sendEvent({
                type: 'browser_panel_opened',
                runId,
                taskId,
                browserTabId: browserTab.id,
                createdAt: Date.now()
              })
              await service.show(browserTab.id)
              const result = await service.run({
                tabId: browserTab.id,
                action,
                instruction: instruction || '打开网页',
                url,
                llmConfig: await ctx.getLlmConfig()
              })
              const payload = { ...result }
              const sizeCheck = checkToolResultSize({
                toolName: BROWSER_USE_TOOL_SPEC.name,
                value: payload,
                modelContextWindowTokens:
                  ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
                  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
              })
              if (sizeCheck.tooLarge) {
                const tooLargePayload = {
                  error: 'browser_use result too large',
                  reason: 'result_too_large',
                  estimatedTokens: sizeCheck.estimatedTokens,
                  limit: sizeCheck.limit,
                  ...(sizeCheck.decisionHint ? { decisionHint: sizeCheck.decisionHint } : {})
                }
                session.fail(
                  tooLargePayload.error,
                  undefined,
                  buildToolResult({
                    toolName: BROWSER_USE_TOOL_SPEC.name,
                    ok: false,
                    data: tooLargePayload
                  })
                )
                return tooLargePayload
              }

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

    return [webSearch, webCrawl, browserUse]
  }
}
