import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { isManagedModelConfigId, managedModelEntryId } from '../../../shared/managedModels'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { getAppRuntime, serviceApiUrl } from '../app/AppRuntime'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS } from '../ai/constants'
import { LlmProviderError, type LlmBillingStatus } from '../ai/errors'
import { isProviderFailureCode, providerFailure, providerFailureMessage } from '../ai/providerFailure'
import { classifyManagedLlmRetry, ManagedModelConcurrencyRejection } from '../ai/llmRetry'
import { buildDesktopAppGatewayHeaders } from './appClient'
import { currentDomesticDesktopAccount } from './desktopAccount'

const endpoint = '/api/v2/managed'
const resultEvent = 'ncurator.result'
const finishReasons = new Set(['stop', 'length', 'tool_calls', 'content_filter'])
const invocations = new WeakMap<LlmRuntimeConfig, { requestId: string; retryRequestId?: string; scope: Scope }>()
const modelScopes = new WeakMap<LlmRuntimeConfig, Scope>()

export { isManagedModelConfigId } from '../../../shared/managedModels'

export function forManagedInvocation(config: LlmRuntimeConfig) {
  if (!isManagedModelConfigId(config.id)) return config
  const scope = modelScopes.get(config)
  if (!scope) throw failure('unauthorized')
  scope.assertCurrent()
  const invocation = { ...config }
  invocations.set(invocation, { requestId: randomUUID(), scope })
  return invocation
}

export function resolveManagedRuntimeConfig(configId: string, name: string,
  scope = currentDomesticDesktopAccount().managedCallScope(), effort?: string): LlmRuntimeConfig {
  const id = managedModelEntryId(configId)
  if (!id || getAppRuntime().distribution !== 'domestic') throw new Error('馆长模型暂不可用')
  scope.assertCurrent()
  const config: LlmRuntimeConfig = { id: configId, name, providerKind: 'openai-compatible', base_url: serviceApiUrl('domestic', endpoint),
    api_key: 'managed-placeholder', model_name: id, ...(effort && { effort }) }
  modelScopes.set(config, scope)
  return config
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

function billingFrom(value: unknown): LlmBillingStatus {
  if (!record(value) || value.status !== 'settled') return 'unknown'
  if (value.feeDecision === 'waive') return 'waived'
  if (value.feeDecision === 'charge') return 'charged'
  return 'unknown'
}

const failure = (code: string, status?: number, billing?: LlmBillingStatus, retryable?: boolean) =>
  providerFailure(isProviderFailureCode(code) ? code : 'failed', { status, billing, retryable })

type Scope = ReturnType<ReturnType<typeof currentDomesticDesktopAccount>['managedCallScope']>
type Dependencies = {
  fetch: typeof fetch
  wait: (ms: number, signal: AbortSignal) => Promise<unknown>
}

function frameParts(raw: string) {
  const lines = raw.split(/\r?\n/)
  const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
  return { event, data }
}

function managedStream(response: Response, requestId: string, scope: Scope,
  recover: () => ReturnType<Scope['recover']>, onRetry: () => void) {
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

  function assertCompleteOutput(billing?: LlmBillingStatus) {
    if (finishReason === 'length') throw failure('output_truncated', undefined, billing)
    if (finishFrame && !invalidTool && ((finishReason === 'stop' && hasText && tools.size === 0) ||
      (finishReason === 'tool_calls' && tools.size > 0 && [...tools.values()].every(tool =>
        tool.id && tool.name && validArguments(tool.arguments))))) return
    throw failure('incomplete', undefined, billing, billing === 'waived')
  }

  async function finishFromStatus(controller: ReadableStreamDefaultController<Uint8Array>, error?: string) {
    const status = await recover()
    const billing = billingFrom(status)
    if (status.status !== 'settled' || status.executionStatus !== 'completed') {
      const code = error && isProviderFailureCode(error) ? error
        : status.status === 'settlement_pending' ? 'settlement_pending' : 'incomplete'
      throw failure(code, undefined, billing, code === 'incomplete' && billing === 'waived')
    }
    settled = true
    assertCompleteOutput(billing)
    closeSuccess(controller)
  }

  function closeSuccess(controller: ReadableStreamDefaultController<Uint8Array>) {
    scope.assertCurrent()
    controller.enqueue(encoder.encode(finishFrame + '\n\ndata: [DONE]\n\n'))
    controller.close()
    void reader.cancel().catch(() => undefined)
  }

  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          scope.assertCurrent()
          const boundary = /\r?\n\r?\n/.exec(buffer)
          if (!boundary) {
            if (buffer.length > 1_048_576) throw failure('incomplete')
            let next: ReadableStreamReadResult<Uint8Array>
            try { next = await reader.read() }
            catch { await finishFromStatus(controller); return }
            scope.assertCurrent()
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
            const billing = billingFrom(value.billing)
            if (value.billing.status === 'settled') {
              scope.applyWallet(value.billing.wallet)
              settled = true
              if (value.result !== 'completed') {
                const code = typeof value.error === 'string' && isProviderFailureCode(value.error) ? value.error
                  : value.result === 'failed' ? 'upstream_error' : 'incomplete'
                throw failure(code, undefined, billing,
                  value.retryable === true && billing === 'waived')
              }
              assertCompleteOutput(billing)
              closeSuccess(controller)
            } else {
              await finishFromStatus(controller, typeof value.error === 'string' ? value.error : undefined)
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
        if (error instanceof LlmProviderError && error.retryable) onRetry()
        controller.error(error instanceof LlmProviderError ? error : failure('incomplete'))
      }
    },
    async cancel() {
      try { await reader.cancel() } finally { void recover().catch(() => undefined) }
    }
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}

export function createManagedModelFetch(config: LlmRuntimeConfig, deps: Dependencies = {
  fetch: globalThis.fetch, wait: (ms, signal) => delay(ms, undefined, { signal })
}): typeof fetch {
  const id = managedModelEntryId(config.id)
  if (!id || getAppRuntime().distribution !== 'domestic') throw failure('model_not_found')
  const url = serviceApiUrl('domestic', endpoint + '/chat/completions')
  const invocation = invocations.get(config)
  return async (input, init) => {
    const request = new Request(input, init)
    if (request.url !== url || request.method !== 'POST') throw failure('model_not_found')
    const parsed: unknown = JSON.parse(await request.text())
    if (!record(parsed)) throw failure('incomplete')
    // Each upstream attempt is a separate managed execution. A retry must not
    // reuse a request id that the server may already have admitted.
    const requestId = invocation?.retryRequestId ?? invocation?.requestId ?? randomUUID()
    const body = JSON.stringify({ ...parsed, model: id, requestId })
    const routeId = randomUUID()
    const scope = invocation?.scope ?? modelScopes.get(config)
    if (!scope) throw failure('unauthorized')
    let recovered: ReturnType<Scope['recover']> | undefined
    const recover = () => recovered ??= scope.recover(requestId, AbortSignal.timeout(5_000))
    let access = await scope.accessToken()
    let refreshed = false
    for (let attempt = 0; ; ) {
      request.signal.throwIfAborted()
      scope.assertCurrent()
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
      try { scope.assertCurrent() } catch (error) {
        await response.body?.cancel().catch(() => undefined)
        throw error
      }
      if (response.status === 202) {
        await response.body?.cancel()
        await recover().catch(() => undefined)
        // The execution is already admitted but its outcome is unknown; replaying
        // it would create a second admitted call. Recover instead of retrying.
        throw failure('incomplete', undefined, undefined, false)
      }
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => undefined)
        const code = record(result) && typeof result.error === 'string' && isProviderFailureCode(result.error) ? result.error : 'failed'
        if (response.status === 401 && code === 'access_token_expired' && !refreshed) {
          refreshed = true
          access = await scope.accessToken(access)
          continue
        }
        if (response.status === 429 && code === 'model_concurrency_limited') {
          const rejection = new ManagedModelConcurrencyRejection(providerFailureMessage('model_concurrency_limited'))
          if (invocation) throw rejection
          if (attempt < AI_LLM_CALL_MAX_RETRY_ATTEMPTS) {
            const retry = classifyManagedLlmRetry(rejection, ++attempt)
            await deps.wait(retry.delayMs ?? 0, request.signal)
            access = await scope.accessToken()
            continue
          }
        }
        if (response.status >= 500) void recover().catch(() => undefined)
        // An unknown 429 is not the admission-safe concurrency rejection; do not
        // replay a call whose admission/outcome may already exist.
        throw failure(code, response.status, undefined, response.status === 429 ? false : undefined)
      }
      if (parsed.stream === true && response.body && response.headers.get('content-type')?.startsWith('text/event-stream')) {
        return managedStream(response, requestId, scope, recover, () => {
          if (invocation) invocation.retryRequestId = randomUUID()
        })
      }
      const result: unknown = await response.json().catch(() => undefined)
      if (!record(result) || !record(result.ncurator) || result.ncurator.requestId !== requestId || !record(result.ncurator.billing)) {
        await recover().catch(() => undefined)
        throw failure('incomplete')
      }
      const { ncurator, ...completion } = result
      let billing = billingFrom(result.ncurator.billing)
      if (result.ncurator.billing.status === 'settled') scope.applyWallet(result.ncurator.billing.wallet)
      else {
        const recoveredStatus = await recover().catch(() => undefined)
        billing = billingFrom(recoveredStatus)
        if (recoveredStatus?.status !== 'settled' || recoveredStatus.executionStatus !== 'completed') {
          throw failure('settlement_pending', undefined, billing)
        }
      }
      const firstChoice: unknown = Array.isArray(completion.choices) ? completion.choices[0] : undefined
      if (ncurator.result !== 'completed' || !record(firstChoice) || !record(firstChoice.message)) {
        const code = typeof ncurator.error === 'string' && isProviderFailureCode(ncurator.error) ? ncurator.error : 'incomplete'
        throw failure(code, undefined, billing)
      }
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
