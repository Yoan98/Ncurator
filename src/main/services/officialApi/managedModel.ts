import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { officialUrl } from '../../../shared/appPreferences'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { getAppRuntime } from '../app/AppRuntime'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS } from '../ai/constants'
import { LlmProviderError } from '../ai/errors'
import { classifyManagedLlmRetry, ManagedModelConcurrencyRejection } from '../ai/llmRetry'
import { buildDesktopAppGatewayHeaders } from './appClient'
import { currentDomesticDesktopAccount } from './desktopAccount'

const managedId = /^managed:([1-9]\d{0,18})$/
const maxId = '9223372036854775807'
const endpoint = '/api/v2/managed'
const resultEvent = 'ncurator.result'
const finishReasons = new Set(['stop', 'length', 'tool_calls', 'content_filter'])
const invocations = new WeakMap<LlmRuntimeConfig, { requestId: string; scope: Scope }>()

function modelId(configId: string) {
  const value = managedId.exec(configId)?.[1]
  return value && (value.length < 19 || value <= maxId) ? value : undefined
}

export const isManagedModelConfigId = (id: string) => modelId(id) !== undefined

export function forManagedInvocation(config: LlmRuntimeConfig) {
  if (!isManagedModelConfigId(config.id)) return config
  const invocation = { ...config }
  invocations.set(invocation, { requestId: randomUUID(), scope: currentDomesticDesktopAccount().managedCallScope() })
  return invocation
}

export function resolveManagedRuntimeConfig(configId: string, name: string): LlmRuntimeConfig {
  const id = modelId(configId)
  if (!id || getAppRuntime().distribution !== 'domestic') throw new Error('馆长模型暂不可用')
  currentDomesticDesktopAccount().managedCallScope()
  return { id: configId, name, providerKind: 'openai-compatible', base_url: officialUrl('domestic', endpoint),
    api_key: 'managed-placeholder', model_name: id }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validArguments(value: unknown) {
  if (typeof value !== 'string') return false
  try { return record(JSON.parse(value)) } catch { return false }
}

function completeToolCall(value: unknown) {
  return record(value) && typeof value.id === 'string' && !!value.id && value.type === 'function' &&
    record(value.function) && typeof value.function.name === 'string' && !!value.function.name && validArguments(value.function.arguments)
}

const messages: Record<string, string> = {
  balance_insufficient: '余额不足，请充值或缩短本次上下文',
  payment_required: '馆长账户有未付费用，请充值后再试',
  settlement_in_progress: '上一笔费用仍在处理，请稍后再试',
  settlement_pending: '本次费用仍在处理',
  model_concurrency_limited: '馆长模型正在处理较多请求，请稍后再试',
  unauthorized: '馆长账户登录已失效，请重新登录',
  access_token_expired: '馆长账户登录已失效，请重新登录',
  model_not_found: '该馆长模型已不可用，请重新选择',
  context_limit: '本次上下文超过模型限制，请缩短后重试',
  incomplete: '本次回答未完整接收',
  output_truncated: '本次回答达到输出上限，内容未完整接收',
  failed: '馆长模型调用失败，请稍后再试'
}
const failure = (code: string, status?: number) => new LlmProviderError({
  message: messages[code] || '馆长模型服务暂不可用', providerCode: code, httpStatus: status, retryable: false
})

type Scope = ReturnType<ReturnType<typeof currentDomesticDesktopAccount>['managedCallScope']>
type Dependencies = {
  scope: () => Scope
  fetch: typeof fetch
  wait: (ms: number, signal: AbortSignal) => Promise<unknown>
}

function frameParts(raw: string) {
  const lines = raw.split(/\r?\n/)
  const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
  return { event, data }
}

function managedStream(response: Response, requestId: string, scope: Scope, recover: () => ReturnType<Scope['recover']>) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let finishFrame: string | undefined
  let finishReason: string | undefined
  let hasText = false
  let invalidTool = false
  let settled = false
  const tools = new Map<number, { id: string; name: string; arguments: string }>()

  function collectTools(value: unknown) {
    if (!Array.isArray(value)) { invalidTool = true; return }
    for (const tool of value) {
      if (!record(tool) || typeof tool.index !== 'number' || !Number.isSafeInteger(tool.index) || tool.index < 0 ||
        !record(tool.function) || (tool.type !== undefined && tool.type !== 'function')) { invalidTool = true; continue }
      const previous = tools.get(tool.index) ?? { id: '', name: '', arguments: '' }
      if (typeof tool.id === 'string') {
        if (previous.id && previous.id !== tool.id) invalidTool = true
        previous.id = tool.id
      }
      if (typeof tool.function.name === 'string') previous.name += tool.function.name
      if (typeof tool.function.arguments === 'string') previous.arguments += tool.function.arguments
      tools.set(tool.index, previous)
    }
  }

  function assertCompleteOutput() {
    if (finishReason === 'length') throw failure('output_truncated')
    if (finishFrame && !invalidTool && ((finishReason === 'stop' && hasText && tools.size === 0) ||
      (finishReason === 'tool_calls' && tools.size > 0 && [...tools.values()].every(tool =>
        tool.id && tool.name && validArguments(tool.arguments))))) return
    throw failure('incomplete')
  }

  async function finishFromStatus(controller: ReadableStreamDefaultController<Uint8Array>) {
    const status = await recover()
    if (status.status !== 'settled' || status.executionStatus !== 'completed') {
      throw failure(status.status === 'settlement_pending' ? 'settlement_pending' : 'incomplete')
    }
    settled = true
    assertCompleteOutput()
    closeSuccess(controller)
  }

  function closeSuccess(controller: ReadableStreamDefaultController<Uint8Array>) {
    controller.enqueue(encoder.encode(finishFrame + '\n\ndata: [DONE]\n\n'))
    controller.close()
    void reader.cancel().catch(() => undefined)
  }

  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffer)
          if (!boundary) {
            if (buffer.length > 1_048_576) throw failure('incomplete')
            let next: ReadableStreamReadResult<Uint8Array>
            try { next = await reader.read() }
            catch { await finishFromStatus(controller); return }
            if (next.done) { await finishFromStatus(controller); return }
            buffer += decoder.decode(next.value, { stream: true })
            continue
          }
          if (boundary.index > 1_048_576) throw failure('incomplete')
          const raw = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          const { event, data } = frameParts(raw)
          if (!data) continue
          if (data === '[DONE]') { await finishFromStatus(controller); return }
          const value: unknown = JSON.parse(data)
          if (!record(value)) throw failure('incomplete')
          if (event === resultEvent) {
            if (value.requestId !== requestId || !record(value.billing)) throw failure('incomplete')
            if (value.billing.status === 'settled') {
              scope.applyWallet(value.billing.wallet)
              settled = true
              if (value.result !== 'completed') throw failure(value.result === 'failed' ? 'failed' : 'incomplete')
              assertCompleteOutput()
              closeSuccess(controller)
            } else {
              await finishFromStatus(controller)
            }
            return
          }
          if (!Array.isArray(value.choices) || value.choices.length !== 1 || !record(value.choices[0])) throw failure('incomplete')
          const choice = value.choices[0]
          if (typeof choice.finish_reason === 'string') {
            if (finishFrame || !finishReasons.has(choice.finish_reason)) throw failure('incomplete')
            finishFrame = raw
            finishReason = choice.finish_reason
            continue
          }
          if (finishFrame || !record(choice.delta)) throw failure('incomplete')
          if (typeof choice.delta.content === 'string' && choice.delta.content.length > 0) hasText = true
          if (choice.delta.tool_calls !== undefined) collectTools(choice.delta.tool_calls)
          controller.enqueue(encoder.encode(raw + '\n\n'))
          return
        }
      } catch (error) {
        if (!settled) void recover().catch(() => undefined)
        void reader.cancel().catch(() => undefined)
        controller.error(error instanceof LlmProviderError ? error : failure('incomplete'))
      }
    },
    async cancel() {
      try { await reader.cancel() } finally { void recover().catch(() => undefined) }
    }
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}

export function createManagedModelFetch(config: LlmRuntimeConfig, deps: Dependencies = {
  scope: () => currentDomesticDesktopAccount().managedCallScope(),
  fetch: globalThis.fetch, wait: (ms, signal) => delay(ms, undefined, { signal })
}): typeof fetch {
  const id = modelId(config.id)
  if (!id || getAppRuntime().distribution !== 'domestic') throw failure('model_not_found')
  const url = officialUrl('domestic', endpoint + '/chat/completions')
  const invocation = invocations.get(config)
  return async (input, init) => {
    const request = new Request(input, init)
    if (request.url !== url || request.method !== 'POST') throw failure('model_not_found')
    const parsed: unknown = JSON.parse(await request.text())
    if (!record(parsed)) throw failure('incomplete')
    const requestId = invocation?.requestId ?? randomUUID()
    const body = JSON.stringify({ ...parsed, model: id, requestId })
    const routeId = randomUUID()
    const scope = invocation?.scope ?? deps.scope()
    let recovered: ReturnType<Scope['recover']> | undefined
    const recover = () => recovered ??= scope.recover(requestId, AbortSignal.timeout(5_000))
    let access = await scope.accessToken()
    let refreshed = false
    for (let attempt = 0; ; ) {
      request.signal.throwIfAborted()
      const headers = new Headers(buildDesktopAppGatewayHeaders({ method: 'POST', url, body }))
      headers.set('Content-Type', 'application/json')
      headers.set('Authorization', 'Bearer ' + access)
      headers.set('Makers-Conversation-Id', routeId)
      let response: Response
      try { response = await deps.fetch(url, { method: 'POST', body, headers, signal: request.signal, redirect: 'error', cache: 'no-store' }) }
      catch {
        void recover().catch(() => undefined)
        request.signal.throwIfAborted()
        throw failure('incomplete')
      }
      if (response.status === 202) {
        await response.body?.cancel()
        await recover().catch(() => undefined)
        throw failure('incomplete')
      }
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => undefined)
        const code = record(result) && typeof result.error === 'string' && Object.hasOwn(messages, result.error) ? result.error : 'failed'
        if (response.status === 401 && code === 'access_token_expired' && !refreshed) {
          refreshed = true
          access = await scope.accessToken(access)
          continue
        }
        if (response.status === 429 && code === 'model_concurrency_limited') {
          const rejection = new ManagedModelConcurrencyRejection(messages[code])
          if (invocation) throw rejection
          if (attempt < AI_LLM_CALL_MAX_RETRY_ATTEMPTS) {
            const retry = classifyManagedLlmRetry(rejection, ++attempt)
            await deps.wait(retry.delayMs ?? 0, request.signal)
            access = await scope.accessToken()
            continue
          }
        }
        if (response.status >= 500) void recover().catch(() => undefined)
        throw failure(code, response.status)
      }
      if (parsed.stream === true && response.body && response.headers.get('content-type')?.startsWith('text/event-stream')) {
        return managedStream(response, requestId, scope, recover)
      }
      const result: unknown = await response.json().catch(() => undefined)
      if (!record(result) || !record(result.ncurator) || result.ncurator.requestId !== requestId || !record(result.ncurator.billing)) {
        await recover().catch(() => undefined)
        throw failure('incomplete')
      }
      const { ncurator, ...completion } = result
      if (result.ncurator.billing.status === 'settled') scope.applyWallet(result.ncurator.billing.wallet)
      else {
        const recoveredStatus = await recover().catch(() => undefined)
        if (recoveredStatus?.status !== 'settled' || recoveredStatus.executionStatus !== 'completed') throw failure('settlement_pending')
      }
      const firstChoice: unknown = Array.isArray(completion.choices) ? completion.choices[0] : undefined
      if (ncurator.result !== 'completed' || !record(firstChoice) || !record(firstChoice.message)) throw failure('incomplete')
      if (firstChoice.finish_reason === 'length') throw failure('output_truncated')
      const toolCalls = firstChoice.message.tool_calls
      const text = firstChoice.message.content
      const complete = firstChoice.finish_reason === 'tool_calls' && Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls.every(completeToolCall) ||
        firstChoice.finish_reason === 'stop' && typeof text === 'string' && text.length > 0 &&
        (toolCalls == null || Array.isArray(toolCalls) && toolCalls.length === 0)
      if (!complete) throw failure('incomplete')
      return Response.json(completion, { headers: { 'cache-control': 'no-store' } })
    }
  }
}
