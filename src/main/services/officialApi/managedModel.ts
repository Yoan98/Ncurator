import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { isManagedModelConfigId, managedModelEntryId } from '../../../shared/managedModels'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { getAppRuntime, serviceApiUrl } from '../app/AppRuntime'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS } from '../ai/constants'
import { LlmProviderError, type LlmBillingStatus, type LlmProviderDiagnostics } from '../ai/errors'
import { isProviderFailureCode, providerFailure, providerFailureMessage } from '../ai/providerFailure'
import { classifyManagedLlmRetry, ManagedModelConcurrencyRejection, NON_REPLAYABLE_MANAGED_CODES } from '../ai/llmRetry'
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

function diagnosticSuffix(diagnostics: LlmProviderDiagnostics): string {
  const parts = [
    `结束原因：${String(diagnostics.finishReason ?? '无')}`,
    `正文：${diagnostics.hasText ? '有' : '无'}`,
    `工具调用：${String(diagnostics.toolCount ?? 0)}`
  ]
  if (!diagnostics.finishFrame) parts.push('结束帧：无')
  if (diagnostics.invalidTool) parts.push('工具分片：异常')
  return `（${parts.join('；')}）`
}

const failure = (
  code: string,
  options: {
    status?: number
    billing?: LlmBillingStatus
    retryable?: boolean
    diagnostics?: LlmProviderDiagnostics
    suffix?: string
  } = {}
) => {
  if (options.diagnostics) console.warn('[managed-model]', code, options.diagnostics)
  return providerFailure(isProviderFailureCode(code) ? code : 'failed', {
    status: options.status,
    billing: options.billing,
    retryable: options.retryable,
    diagnostics: options.diagnostics,
    messageSuffix: options.suffix ?? (options.diagnostics ? diagnosticSuffix(options.diagnostics) : undefined)
  })
}

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

function managedStream(response: Response, requestId: string, scope: Scope, allowToolCalls: boolean,
  recover: () => ReturnType<Scope['recover']>, onRetry: () => void) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let finishFrame: string | undefined
  let finishReason: string | undefined
  let hasText = false
  let sawToolCall = false
  let invalidTool = false
  let settled = false
  let latestBilling: LlmBillingStatus | undefined
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

  function streamDiagnostics(billing?: LlmBillingStatus): LlmProviderDiagnostics {
    const completeToolCount = [...tools.values()].filter(tool =>
      tool.id && tool.name && validArguments(tool.arguments)).length
    const effectiveBilling = billing ?? latestBilling
    return {
      requestId,
      finishReason: finishReason ?? '无',
      hasText,
      sawToolCall,
      toolCount: tools.size,
      completeToolCount,
      invalidTool,
      finishFrame: Boolean(finishFrame),
      ...(effectiveBilling ? { billing: effectiveBilling } : {})
    }
  }

  function assertCompleteOutput(billing?: LlmBillingStatus) {
    const diagnostics = streamDiagnostics(billing)
    if (finishReason === 'length') throw failure('output_truncated', { billing, diagnostics })
    if (finishReason === 'content_filter') {
      // Tool-enabled calls go to the brain so it can produce the content-safety fallback.
      if (allowToolCalls && finishFrame) return
      if (!finishFrame) throw failure('incomplete', { billing, retryable: true, diagnostics })
      throw failure('content_filter', { billing, retryable: false, diagnostics })
    }
    // A missing finish frame is a transport interruption, not a payload judgment.
    if (!finishFrame) throw failure('incomplete', { billing, retryable: true, diagnostics })
    // Transport-level completion only: any text or tool-call attempt is usable.
    // Incomplete tool calls are repaired or returned to the model by the brain.
    const usable = allowToolCalls ? hasText || sawToolCall : hasText && !sawToolCall
    if (usable) return
    throw failure('invalid_output', {
      billing,
      retryable: allowToolCalls || !sawToolCall,
      diagnostics
    })
  }

  async function finishFromStatus(controller: ReadableStreamDefaultController<Uint8Array>, error?: string) {
    const status = await recover()
    const billing = billingFrom(status)
    if (status.status !== 'settled' || status.executionStatus !== 'completed') {
      const code = error && isProviderFailureCode(error) ? error
        : status.status === 'settlement_pending' ? 'settlement_pending' : 'incomplete'
      const admitted = status.status !== 'settled' && status.status !== 'not_found'
      const terminal = 'executionStatus' in status ? status.executionStatus : undefined
      const retryable = admitted || terminal === 'cancelled' || terminal === 'lost' ||
          NON_REPLAYABLE_MANAGED_CODES.has(code)
        ? false
        : undefined
      throw failure(code, {
        billing,
        retryable,
        diagnostics: streamDiagnostics(billing)
      })
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
            latestBilling = billing
            if (value.billing.status === 'settled') {
              scope.applyWallet(value.billing.wallet)
              settled = true
              if (value.result !== 'completed') {
                const code = typeof value.error === 'string' && isProviderFailureCode(value.error) ? value.error
                  : value.result === 'failed' ? 'upstream_error' : 'incomplete'
                const retryable = NON_REPLAYABLE_MANAGED_CODES.has(code) ? false
                  : typeof value.retryable === 'boolean' ? value.retryable : undefined
                throw failure(code, { billing, retryable, diagnostics: streamDiagnostics(billing) })
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
          if (choice.delta.tool_calls !== undefined) {
            // Any tool-call attempt belongs to the client's brain, even when
            // individual argument fragments are incomplete.
            if (!Array.isArray(choice.delta.tool_calls) || choice.delta.tool_calls.length > 0) sawToolCall = true
            collectTools(choice.delta.tool_calls)
          }
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
    const allowToolCalls = Array.isArray(parsed.tools) && parsed.tools.length > 0
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
        // A transport failure is safe to retry with the same requestId: the
        // gateway deduplicates by requestId, so an already-admitted execution
        // is looked up instead of being executed twice. Do not gate this on a
        // successful recovery: during a brief backend rollout that query is
        // unavailable too, and the client still needs the retry.
        request.signal.throwIfAborted()
        throw failure('incomplete', {
          retryable: true,
          diagnostics: { transport: true, requestId },
          suffix: ''
        })
      }
      try { scope.assertCurrent() } catch (error) {
        await response.body?.cancel().catch(() => undefined)
        throw error
      }
      if (response.status === 202) {
        await response.body?.cancel()
        const status = await recover().catch(() => undefined)
        if (status?.status === 'settled') {
          // The previous execution is finished. A fresh request cannot duplicate
          // an in-flight call, so it is safe to retry as a new call.
          if (invocation) invocation.retryRequestId = randomUUID()
          const billing = billingFrom(status)
          throw failure('incomplete', {
            retryable: true,
            diagnostics: { transport: true, admitted: true, requestId, billing },
            suffix: ''
          })
        }
        // Admitted/in-flight or recovery unavailable: retry the same requestId.
        // The gateway treats a duplicate requestId as a lookup, not a new call.
        throw failure('incomplete', {
          retryable: true,
          diagnostics: { transport: true, admitted: true, requestId },
          suffix: ''
        })
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
        // replay a call whose admission/outcome may already exist. A 5xx during a
        // short backend rollout is transient and retries with the same requestId.
        throw failure(code, {
          status: response.status,
          retryable: response.status === 429 ? false : undefined,
          ...(response.status >= 500 && {
            diagnostics: { transport: true, requestId },
            suffix: ''
          })
        })
      }
      if (parsed.stream === true && response.body && response.headers.get('content-type')?.startsWith('text/event-stream')) {
        return managedStream(response, requestId, scope, allowToolCalls, recover, () => {
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
          throw failure('settlement_pending', { billing, retryable: false })
        }
      }
      const firstChoice: unknown = Array.isArray(completion.choices) ? completion.choices[0] : undefined
      if (ncurator.result !== 'completed' || !record(firstChoice) || !record(firstChoice.message)) {
        const code = typeof ncurator.error === 'string' && isProviderFailureCode(ncurator.error)
          ? ncurator.error : 'incomplete'
        throw failure(code, {
          billing,
          retryable: NON_REPLAYABLE_MANAGED_CODES.has(code) ? false : undefined,
          diagnostics: {
            requestId,
            finishReason: '无',
            hasText: false,
            sawToolCall: false,
            toolCount: 0,
            completeToolCount: 0,
            invalidTool: false,
            finishFrame: false,
            billing
          }
        })
      }
      const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : '无'
      const toolCalls = firstChoice.message.tool_calls
      const text = firstChoice.message.content
      const hasText = typeof text === 'string' && text.length > 0
      const toolCallCount = Array.isArray(toolCalls) ? toolCalls.length : 0
      const completeToolCount = Array.isArray(toolCalls) ? toolCalls.filter(completeToolCall).length : 0
      const diagnostics: LlmProviderDiagnostics = {
        requestId,
        finishReason,
        hasText,
        sawToolCall: toolCallCount > 0,
        toolCount: toolCallCount,
        completeToolCount,
        invalidTool: false,
        finishFrame: true,
        billing
      }
      if (finishReason === 'length') throw failure('output_truncated', { billing, diagnostics })
      if (finishReason === 'content_filter') {
        if (allowToolCalls) return Response.json(completion, { headers: { 'cache-control': 'no-store' } })
        throw failure('content_filter', { billing, retryable: false, diagnostics })
      }
      const usable = allowToolCalls ? hasText || toolCallCount > 0 : hasText && toolCallCount === 0
      if (!usable) {
        throw failure('invalid_output', {
          billing,
          retryable: allowToolCalls || toolCallCount === 0,
          diagnostics
        })
      }
      return Response.json(completion, { headers: { 'cache-control': 'no-store' } })
    }
  }
}
