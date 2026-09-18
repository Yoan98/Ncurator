import { createHash, randomUUID } from 'node:crypto'
import { normalizeOpenAIBaseUrl } from '../../../../shared/llmBaseUrl'
import { emitActivity } from '../../../utils/aiCapabilityUtils'
import type { AiEventDispatchContext } from '../types'
import type {
  AiLlmRequestWire,
  AiLlmStreamingMode,
  AiLlmUsage,
  BrainContextBudgetSnapshot,
  JsonObject,
  JsonValue,
  LlmProviderKind
} from '../../../../shared/types'
import {
  emitLlmRetryProcessCompleted,
  emitLlmRetryProcessFailed,
  emitLlmRetryProcessStarted
} from '../events/processEvents'
import { classifyThrownErrorToAiRunFailure, isCancelledError } from './runFailure'
import { LlmProviderError, isLlmOutputError, isLlmProviderError } from '../errors'
import { classifyLlmRetry, isLlmTransportError } from '../llmRetry'
import { normalizeStructuredOutputError } from '../structuredOutput'

export type LlmCallStreamObserver = {
  onStart?: () => void
  onDelta?: (text: string) => void
  onReset?: () => void
  onToolCallDelta?: () => void
  onComplete?: (input: { rawText?: string }) => void
  onError?: (error: Error) => void
}

type LlmActionType = 'llm_structured_output' | 'llm_text_output' | 'llm_tool_calls'

type LlmCallTelemetry = {
  actionType: LlmActionType
  caller: string
  schemaName: string
  modelName: string
  baseUrl: string
  providerKind?: LlmProviderKind
  streamingMode: AiLlmStreamingMode
  attempt?: number
  contextBudgetSnapshot?: BrainContextBudgetSnapshot
}

export type LlmCallExecutionResult<T> = {
  output: T
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
  finishReason?: string
}

type LlmCallRetryDecision = {
  retryable: boolean
  message: string
  delayMs?: number
}

const createCancelledError = (): Error & { code: string } => {
  const error = new Error('已取消') as Error & { code: string }
  error.code = 'CANCELLED'
  return error
}

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  const delay = Math.max(0, ms)
  if (delay === 0) return
  if (signal?.aborted) throw createCancelledError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(createCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const reasonFromError = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : String(error || 'unknown')

export const toProviderFailure = (error: unknown, retryable?: boolean): unknown => {
  if (isLlmProviderError(error) || isLlmOutputError(error)) return error
  if (isCancelledError(error)) return error
  const info = normalizeStructuredOutputError(error)
  if (!info.hasProviderSignal && !isLlmTransportError(error)) return error
  // Stamp retryable from the classify result at throw time; later classifyLlmRetry re-parses signals.
  const decision = retryable === undefined ? classifyLlmRetry(error) : undefined
  return new LlmProviderError({
    message: info.message || '模型服务请求失败。',
    httpStatus: info.status,
    providerCode: info.code,
    providerType: info.type,
    retryable: retryable ?? decision?.retryable ?? false,
    cause: error
  })
}

const readRawTextFromError = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const rawText = (error as { rawText?: unknown }).rawText
  return typeof rawText === 'string' && rawText ? rawText : undefined
}

const resolveBaseUrlHost = (baseUrl: string): string => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl)
  if (!normalized) return 'unknown'

  try {
    return new URL(normalized).host || normalized
  } catch {
    return normalized
  }
}

const hashText = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

const formatLlmActivitySummary = (input: {
  status: 'started' | 'completed' | 'failed'
  telemetry: LlmCallTelemetry
  durationMs?: number
  reason?: string
}): string => {
  const target = `${input.telemetry.caller} -> ${input.telemetry.schemaName}`
  if (input.status === 'started') {
    return `LLM 调用开始：${target}`
  }

  if (input.status === 'completed') {
    return `LLM 调用完成：${target}（${input.durationMs || 0}ms）`
  }

  return `LLM 调用失败：${target}（${input.durationMs || 0}ms）${input.reason ? `；${input.reason}` : ''}`
}

export const runLlmCallWithActivity = async <T>(input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  system: string
  user: string
  requestWire?: AiLlmRequestWire
  telemetry: LlmCallTelemetry
  onTextDelta?: (text: string) => void
  onTextReset?: () => void
  onToolCallDelta?: () => void
  execute: (observer: LlmCallStreamObserver, callId: string) => Promise<LlmCallExecutionResult<T>>
  /** Max automatic retries after the first failure (UI shows 正在重试 n/{maxAttempts}). */
  maxAttempts?: number
  classifyRetry?: (error: unknown, attempt: number) => LlmCallRetryDecision
}): Promise<LlmCallExecutionResult<T>> => {
  const startedAt = Date.now()
  const baseUrlHost = resolveBaseUrlHost(input.telemetry.baseUrl)
  const callId = randomUUID()
  const stablePrefixHash = hashText(input.system)
  const dynamicContextHash = hashText(input.user)
  let chunkCount = 0
  let firstTokenAt: number | undefined
  let latestRawText = ''
  const contextBudgetSnapshot =
    input.telemetry.caller === 'human.brain'
      ? input.telemetry.contextBudgetSnapshot
      : undefined

  const details = {
    callId,
    caller: input.telemetry.caller,
    schemaName: input.telemetry.schemaName,
    providerKind: input.telemetry.providerKind,
    model: input.telemetry.modelName,
    baseUrlHost,
    attempt: input.telemetry.attempt || 1,
    streamingMode: input.telemetry.streamingMode,
    stablePrefixHash,
    dynamicContextHash
  }

  const normalizeOutput = (value: T): JsonValue | undefined => {
    try {
      return JSON.parse(JSON.stringify(value)) as JsonValue
    } catch {
      return undefined
    }
  }

  const observer: LlmCallStreamObserver = {
    onStart: () => undefined,
    onDelta: (text) => {
      if (!text) return
      const createdAt = Date.now()
      chunkCount += 1
      latestRawText += text
      if (!firstTokenAt) {
        firstTokenAt = createdAt
      }
      input.ctx.sendEvent({
        type: 'llm_stream_delta',
        runId: input.runId,
        taskId: input.taskId,
        callId,
        caller: input.telemetry.caller,
        chunkIndex: chunkCount,
        text,
        createdAt,
        internal: true
      })
      input.onTextDelta?.(text)
    },
    onReset: () => input.onTextReset?.(),
    onToolCallDelta: () => input.onToolCallDelta?.(),
    onComplete: (payload) => {
      latestRawText = payload.rawText || latestRawText
    },
    onError: () => undefined
  }

  emitActivity({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    actionType: input.telemetry.actionType,
    status: 'started',
    summary: formatLlmActivitySummary({
      status: 'started',
      telemetry: input.telemetry
    }),
    details
  })

  observer.onStart?.()

  try {
    const maxRetries = Math.max(0, Math.floor(input.maxAttempts || 0))
    let retryCount = 0
    let retryGroupStarted = false
    let result: LlmCallExecutionResult<T> | undefined
    for (;;) {
      try {
        result = await input.execute(observer, callId)
        if (retryGroupStarted) {
          emitLlmRetryProcessCompleted({
            sendEvent: input.ctx.sendEvent,
            runId: input.runId,
            callId
          })
        }
        break
      } catch (error) {
        const nextRetry = retryCount + 1
        const retry =
          input.classifyRetry?.(error, nextRetry) ||
          ({ retryable: false, message: reasonFromError(error) } satisfies LlmCallRetryDecision)
        if (!retry.retryable || retryCount >= maxRetries) {
          if (retryGroupStarted) {
            emitLlmRetryProcessFailed({
              sendEvent: input.ctx.sendEvent,
              runId: input.runId,
              callId,
              error: retry.message
            })
          }
          throw toProviderFailure(error, retry.retryable)
        }
        retryCount = nextRetry
        latestRawText = ''
        chunkCount = 0
        firstTokenAt = undefined
        observer.onReset?.()
        retryGroupStarted = true
        emitLlmRetryProcessStarted({
          sendEvent: input.ctx.sendEvent,
          runId: input.runId,
          callId,
          attempt: retryCount,
          maxAttempts: maxRetries,
          message: retry.message
        })
        const delayMs = retry.delayMs ?? Math.min(1_500, 250 * retryCount)
        await sleep(Math.max(0, delayMs), input.ctx.abortSignal)
      }
    }
    if (!result) throw new Error('llm_call_missing_result')
    const durationMs = Date.now() - startedAt
    const rawText = result.rawText ?? (latestRawText || undefined)
    observer.onComplete?.({ rawText })
    const streamed = Boolean(result.streamed || chunkCount > 0)
    const firstTokenLatencyMs = firstTokenAt ? firstTokenAt - startedAt : undefined

    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: input.telemetry.actionType,
      status: 'completed',
      summary: formatLlmActivitySummary({
        status: 'completed',
        telemetry: input.telemetry,
        durationMs
      }),
      details: {
        ...details,
        durationMs,
        streamed,
        chunkCount,
        firstTokenLatencyMs,
        usage: result.usage,
        responseMetadata: result.responseMetadata,
        usageMetadata: result.usageMetadata
      }
    })

    input.ctx.recordLlmIo?.({
      callId,
      runId: input.runId,
      taskId: input.taskId,
      caller: input.telemetry.caller,
      schemaName: input.telemetry.schemaName,
      providerKind: input.telemetry.providerKind,
      model: input.telemetry.modelName,
      baseUrlHost,
      system: input.system,
      user: input.user,
      requestWire: input.requestWire,
      output: normalizeOutput(result.output),
      rawText,
      usage: result.usage,
      stablePrefixHash,
      dynamicContextHash,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata,
      streamingMode: input.telemetry.streamingMode,
      contextBudgetSnapshot,
      streamed,
      chunkCount,
      firstTokenLatencyMs,
      startedAt,
      completedAt: startedAt + durationMs,
      durationMs,
      status: 'completed'
    })
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const reason = reasonFromError(error)
    const reasonCode = classifyThrownErrorToAiRunFailure(error).failureCode
    const normalizedError = error instanceof Error ? error : new Error(reason)
    const failedRawText = readRawTextFromError(error) || latestRawText || undefined
    observer.onError?.(normalizedError)
    const firstTokenLatencyMs = firstTokenAt ? firstTokenAt - startedAt : undefined

    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: input.telemetry.actionType,
      status: 'failed',
      summary: formatLlmActivitySummary({
        status: 'failed',
        telemetry: input.telemetry,
        durationMs,
        reason
      }),
      details: {
        ...details,
        durationMs,
        streamed: chunkCount > 0,
        chunkCount,
        firstTokenLatencyMs,
        reason: reasonCode
      }
    })
    input.ctx.recordLlmIo?.({
      callId,
      runId: input.runId,
      taskId: input.taskId,
      caller: input.telemetry.caller,
      schemaName: input.telemetry.schemaName,
      providerKind: input.telemetry.providerKind,
      model: input.telemetry.modelName,
      baseUrlHost,
      system: input.system,
      user: input.user,
      requestWire: input.requestWire,
      rawText: failedRawText,
      stablePrefixHash,
      dynamicContextHash,
      streamingMode: input.telemetry.streamingMode,
      contextBudgetSnapshot,
      streamed: chunkCount > 0,
      chunkCount,
      firstTokenLatencyMs,
      startedAt,
      completedAt: startedAt + durationMs,
      durationMs,
      status: 'failed',
      reason
    })
    throw toProviderFailure(error, false)
  }
}

export const runStructuredChatWithActivity = async <T>(input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  system: string
  user: string
  telemetry: Omit<LlmCallTelemetry, 'actionType'> & {
    actionType?: 'llm_structured_output'
  }
  execute: (observer: LlmCallStreamObserver, callId: string) => Promise<LlmCallExecutionResult<T>>
}): Promise<LlmCallExecutionResult<T>> =>
  await runLlmCallWithActivity({
    ...input,
    telemetry: {
      ...input.telemetry,
      actionType: 'llm_structured_output'
    }
  })
