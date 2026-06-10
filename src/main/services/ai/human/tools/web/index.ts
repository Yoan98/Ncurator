import { tool } from '@langchain/core/tools'
import { load } from 'cheerio'
import type { AiToolCallResult, IpcJsonObject, JsonValue } from '../../../../../../shared/types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../constants'
import { WebSourceService } from '../../../../web/WebSourceService'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { checkToolResultSize } from '../utils/resultSizeGuard'
import type { ToolFamilyDefinition } from '../types'
import { BROWSER_USE_TOOL_SPEC, WEB_FETCH_TOOL_SPEC } from './toolSpecs'

const webSourceService = new WebSourceService()

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getErrorMessage = (error: Error): string => error.message || String(error)

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

const extractReadableText = (html: string): { title?: string; text: string } => {
  const $ = load(html)
  const title = $('title').first().text().trim() || undefined
  const $root = $('body')
  $root.find('script,style,noscript,nav,header,footer,aside,form,svg,canvas,iframe').remove()
  const text = $root
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
  return { title, text }
}

const buildFetchSuccessPayload = (input: {
  url: string
  statusCode: number
  title?: string
  text: string
}) => ({
  url: input.url,
  statusCode: input.statusCode,
  ...(input.title ? { title: input.title } : {}),
  text: input.text
})

export const webToolFamily: ToolFamilyDefinition = {
  familyId: 'web',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })

    const webFetch = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: WEB_FETCH_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
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
                buildToolResult({ toolName: WEB_FETCH_TOOL_SPEC.name, ok: false, data: payload })
              )
              return payload
            }

            try {
              const response = await fetch(normalizedUrl)
              const finalUrl = response.url || normalizedUrl
              const statusCode = response.status
              if (!response.ok) {
                const payload = {
                  error: `网页请求失败：${String(statusCode)}`,
                  url: finalUrl,
                  statusCode
                }
                session.fail(
                  payload.error,
                  undefined,
                  buildToolResult({ toolName: WEB_FETCH_TOOL_SPEC.name, ok: false, data: payload })
                )
                return payload
              }

              const html = await response.text()
              const extracted = extractReadableText(html)
              if (!extracted.text) {
                const payload = {
                  error: '网页正文为空',
                  url: finalUrl,
                  statusCode
                }
                session.fail(
                  payload.error,
                  undefined,
                  buildToolResult({ toolName: WEB_FETCH_TOOL_SPEC.name, ok: false, data: payload })
                )
                return payload
              }

              const payload = buildFetchSuccessPayload({
                url: finalUrl,
                statusCode,
                title: extracted.title,
                text: extracted.text
              })
              const sizeCheck = checkToolResultSize({
                toolName: WEB_FETCH_TOOL_SPEC.name,
                value: payload,
                modelContextWindowTokens:
                  ctx.humanRuntimeOverrides?.modelContextWindowTokens ||
                  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
              })
              if (sizeCheck.tooLarge) {
                const tooLargePayload = {
                  error: 'web_fetch result too large',
                  url: finalUrl,
                  statusCode,
                  reason: 'result_too_large',
                  estimatedTokens: sizeCheck.estimatedTokens,
                  limit: sizeCheck.limit,
                  ...(sizeCheck.decisionHint ? { decisionHint: sizeCheck.decisionHint } : {})
                }
                session.fail(
                  tooLargePayload.error,
                  undefined,
                  buildToolResult({
                    toolName: WEB_FETCH_TOOL_SPEC.name,
                    ok: false,
                    data: tooLargePayload
                  })
                )
                return tooLargePayload
              }

              session.succeed(
                undefined,
                buildToolResult({ toolName: WEB_FETCH_TOOL_SPEC.name, ok: true, data: payload })
              )
              return payload
            } catch (error) {
              const payload = {
                error: getErrorMessage(error instanceof Error ? error : new Error(String(error))),
                url: normalizedUrl
              }
              session.fail(
                payload.error,
                undefined,
                buildToolResult({ toolName: WEB_FETCH_TOOL_SPEC.name, ok: false, data: payload })
              )
              return payload
            }
          }
        }),
      {
        name: WEB_FETCH_TOOL_SPEC.name,
        description: WEB_FETCH_TOOL_SPEC.promptSpec.description,
        schema: WEB_FETCH_TOOL_SPEC.inputSchema
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
              ctx.sendEvent({
                type: 'browser_panel_opened',
                runId,
                taskId,
                createdAt: Date.now()
              })
              await service.show()
              const result = await service.run({
                action,
                instruction,
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

              const ok = result.action !== 'act' || result.success
              if (ok) {
                session.succeed(
                  undefined,
                  buildToolResult({ toolName: BROWSER_USE_TOOL_SPEC.name, ok: true, data: payload })
                )
              } else {
                session.fail(
                  result.message,
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

    return [webFetch, browserUse]
  }
}
