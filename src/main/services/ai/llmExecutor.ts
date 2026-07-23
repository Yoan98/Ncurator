import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod/v4'
import { createChatModel, getSupportedTransportsForConfig } from '../llm/chatModel'
import { normalizeJsonObject, normalizeLlmUsage } from '../llm/usage'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import type {
  AiLlmUsage,
  AiLlmStreamingMode,
  AiRuntimeSettings,
  AiStructuredOutputMethod,
  AiStructuredOutputTransport,
  BrainContextBudgetSnapshot,
  JsonObject,
  LLMConfig,
  LlmRuntimeConfig,
  LlmProviderKind,
  StructuredOutputMode,
  StructuredOutputStrategy
} from '../../../shared/types'
import type { AiEventDispatchContext } from './types'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS, AI_LLM_CALL_TIMEOUT_MS } from './constants'
import { LlmOutputError, LlmProviderError, isLlmProviderError, toLlmOutputError } from './errors'
import { classifyLlmFailureCode } from './utils/runFailure'
import {
  buildStructuredOutputStrategyAttemptOrder,
  classifyStructuredOutputError,
  extractTextContent,
  formatStructuredOutputStrategy,
  getErrorText,
  isTransportCompatibilityError,
  methodToStructuredOutputMode,
  normalizeStructuredOutputError,
  parseJsonObjectText,
  parsePromptJsonOutput,
  resolveStructuredOutputStrategy,
  type NonScriptedStructuredOutputMethod
} from './structuredOutput'
import {
  runLlmCallWithActivity,
  type LlmCallExecutionResult,
  type LlmCallStreamObserver
} from './utils/structuredChatActivity'

type TextContentPart = {
  text?: string
  content?: string
}

type TextContent = string | TextContentPart | Array<string | TextContentPart>

type TextMessage = {
  content: TextContent
  response_metadata?: Record<string, unknown>
  usage_metadata?: Record<string, unknown>
}

type TextRunnable = {
  invoke: (
    input: Array<SystemMessage | HumanMessage>,
    config?: Partial<RunnableConfig>
  ) => Promise<TextMessage>
  stream: (
    input: Array<SystemMessage | HumanMessage>,
    config?: Partial<RunnableConfig>
  ) => Promise<AsyncIterable<TextMessage>>
  withConfig: (config: Record<string, unknown>) => TextRunnable
}

type BaseLlmInvocationInput = {
  caller: string
  cfg: LlmRuntimeConfig
  schemaName: string
  system: string
  user: string
  temperature?: number
  streamingMode: AiLlmStreamingMode
  observer?: LlmCallStreamObserver
  signal?: AbortSignal
}

export type AiLlmTextInvocationInput = BaseLlmInvocationInput & {
  preferredTransport?: AiStructuredOutputTransport
}

type AiLlmStructuredDriverInput = BaseLlmInvocationInput & {
  preferredStrategy?: StructuredOutputStrategy
  schema: z.ZodType<Record<string, unknown>>
}

export type AiLlmStructuredInvocationInput<T extends Record<string, unknown>> =
  AiLlmStructuredDriverInput & {
    schema: z.ZodType<T>
  }

export type AiLlmTextDriverResult = {
  output: string
  rawText?: string
  transport?: AiStructuredOutputTransport
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmStructuredDriverResult = {
  output: Record<string, unknown>
  rawText?: string
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  structuredOutputMode?: StructuredOutputMode
  strategy?: StructuredOutputStrategy
  fallbackStrategies?: StructuredOutputStrategy[]
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmDriver = {
  chatStructured?: (input: AiLlmStructuredDriverInput) => Promise<AiLlmStructuredDriverResult>
  chatText?: (input: AiLlmTextInvocationInput) => Promise<AiLlmTextDriverResult>
}

export type AiLlmTextRequest = {
  caller: string
  taskId?: string
  schemaName: string
  system: string
  user: string
  temperature?: number
  streamingMode?: AiLlmStreamingMode
  onTextDelta?: (text: string) => void
}

export type AiLlmStructuredRequest<T extends Record<string, unknown>> = {
  caller: string
  taskId?: string
  schemaName: string
  system: string
  user: string
  schema: z.ZodType<T>
  temperature?: number
  streamingMode?: AiLlmStreamingMode
  contextBudgetSnapshot?: BrainContextBudgetSnapshot
}

export type AiLlmExecutor = {
  chatStructured: <T extends Record<string, unknown>>(
    input: AiLlmStructuredRequest<T>
  ) => Promise<{
    output: T
    usage?: AiLlmUsage
  }>
  chatText: (input: AiLlmTextRequest) => Promise<string>
}

export type InvokeStructuredChatInput<T extends Record<string, unknown>> = {
  caller: string
  cfg: LlmRuntimeConfig
  preferredStrategy?: StructuredOutputStrategy
  streamingMode?: AiLlmStreamingMode
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
  driver?: AiLlmDriver
}

export type InvokeStructuredChatResult<T extends Record<string, unknown>> = {
  output: T
  rawText?: string
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  structuredOutputMode?: StructuredOutputMode
  strategy?: StructuredOutputStrategy
  fallbackStrategies: StructuredOutputStrategy[]
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

const resolveStreamingMode = (settings: AiRuntimeSettings): AiLlmStreamingMode =>
  settings.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream'

const buildMessages = (system: string, user: string): Array<SystemMessage | HumanMessage> => [
  new SystemMessage(system),
  new HumanMessage(user)
]

const MAX_CONSECUTIVE_BLANK_STREAM_CHUNKS = 512
const MAX_CONSECUTIVE_BLANK_STREAM_MS = 120_000

const createRunnableConfig = (signal?: AbortSignal): Partial<RunnableConfig> | undefined =>
  signal ? { signal } : undefined

const withAbortTimeout = async <T>(input: {
  execute: (signal: AbortSignal) => Promise<T>
  externalSignal?: AbortSignal
  timeoutMs?: number
}): Promise<T> => {
  const controller = new AbortController()
  const timeoutMs = Math.max(1, Number(input.timeoutMs || AI_LLM_CALL_TIMEOUT_MS))
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let cleanupAbortListener: (() => void) | undefined

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error('llm_call_timeout') as Error & { code?: string }
      timeoutError.code = 'TIMEOUT'
      controller.abort(timeoutError)
      reject(timeoutError)
    }, timeoutMs)
  })

  const externalAbortPromise = new Promise<never>((_resolve, reject) => {
    if (!input.externalSignal) return
    const onAbort = () => {
      const cancelledError = new Error('已取消') as Error & { code?: string }
      cancelledError.code = 'CANCELLED'
      controller.abort(cancelledError)
      reject(cancelledError)
    }
    if (input.externalSignal.aborted) {
      onAbort()
      return
    }
    input.externalSignal.addEventListener('abort', onAbort, { once: true })
    cleanupAbortListener = () => {
      input.externalSignal?.removeEventListener('abort', onAbort)
    }
  })

  try {
    return await Promise.race([
      input.execute(controller.signal),
      timeoutPromise,
      externalAbortPromise
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    cleanupAbortListener?.()
  }
}

const resolveConfigProviderKind = (cfg: LLMConfig): LlmProviderKind =>
  resolveLlmProviderKind({
    providerKind: cfg.providerKind,
    baseUrl: cfg.base_url
  })

const buildTransportAttemptOrder = (
  preferredTransport: AiStructuredOutputTransport | undefined,
  cfg: LlmRuntimeConfig
): AiStructuredOutputTransport[] => {
  const supported = getSupportedTransportsForConfig(cfg)
  if (!preferredTransport || !supported.includes(preferredTransport)) return [...supported]
  return [preferredTransport, ...supported.filter((item) => item !== preferredTransport)]
}

const buildPreferredStrategy = (cfg: LlmRuntimeConfig): StructuredOutputStrategy | undefined => {
  if (!cfg.preferredTransport || !cfg.preferredStructuredOutputMode) return undefined
  return {
    transport: cfg.preferredTransport,
    mode: cfg.preferredStructuredOutputMode
  }
}

const buildStructuredAttemptOrder = (
  preferredStrategy: StructuredOutputStrategy | undefined,
  cfg: LlmRuntimeConfig
): StructuredOutputStrategy[] =>
  buildStructuredOutputStrategyAttemptOrder({
    supportedTransports: getSupportedTransportsForConfig(cfg),
    preferredStrategy: preferredStrategy || buildPreferredStrategy(cfg),
    supportedModes: cfg.supportedStructuredOutputModes
  })

const toInvocationMetadata = (input: {
  message?: TextMessage
  providerKind: LlmProviderKind
}): {
  usage: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
} => ({
  usage: normalizeLlmUsage({
    message: input.message,
    providerKind: input.providerKind
  }),
  responseMetadata: normalizeJsonObject(input.message?.response_metadata),
  usageMetadata: normalizeJsonObject(input.message?.usage_metadata)
})

const buildSchemaDescription = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>
): string | undefined => {
  const description = schema.description?.trim()
  return description ? description : undefined
}

const streamTextFromRunnable = async (input: {
  runnable: TextRunnable
  messages: Array<SystemMessage | HumanMessage>
  observer?: LlmCallStreamObserver
  checkCancelled: () => void
  signal?: AbortSignal
}): Promise<{ text: string; message?: TextMessage }> => {
  input.checkCancelled()
  const stream = await input.runnable.stream(input.messages, createRunnableConfig(input.signal))
  const chunks: string[] = []
  let lastChunk: TextMessage | undefined
  let blankChunkCount = 0
  let blankStreakStartedAt: number | undefined
  for await (const chunk of stream) {
    input.checkCancelled()
    lastChunk = chunk
    const text = extractTextContent(chunk.content)
    if (!text) continue
    if (text.trim()) {
      blankChunkCount = 0
      blankStreakStartedAt = undefined
    } else {
      blankChunkCount += 1
      blankStreakStartedAt ??= Date.now()
      const blankStreakMs = Date.now() - blankStreakStartedAt
      if (
        blankChunkCount > MAX_CONSECUTIVE_BLANK_STREAM_CHUNKS ||
        blankStreakMs > MAX_CONSECUTIVE_BLANK_STREAM_MS
      ) {
        throw new Error(
          [
            'llm_stream_blank_delta_stall',
            `blankChunks=${blankChunkCount}`,
            `blankMs=${blankStreakMs}`
          ].join('; ')
        )
      }
    }
    chunks.push(text)
    input.observer?.onDelta?.(text)
  }
  return { text: chunks.join(''), message: lastChunk }
}

const invokeTextFromRunnable = async (input: {
  runnable: TextRunnable
  messages: Array<SystemMessage | HumanMessage>
  checkCancelled: () => void
  signal?: AbortSignal
}): Promise<{ text: string; message: TextMessage }> => {
  input.checkCancelled()
  const response = await input.runnable.invoke(input.messages, createRunnableConfig(input.signal))
  input.checkCancelled()
  return { text: extractTextContent(response.content), message: response }
}

const createTextRunnable = (input: {
  cfg: LlmRuntimeConfig
  temperature?: number
  transport: AiStructuredOutputTransport
  streaming: boolean
}): TextRunnable =>
  createChatModel(input.cfg, {
    temperature: input.temperature ?? 0.2,
    transport: input.transport,
    streaming: input.streaming,
    timeout: AI_LLM_CALL_TIMEOUT_MS
  }) as TextRunnable

const createStructuredJsonRunnable = <T extends Record<string, unknown>>(input: {
  cfg: LlmRuntimeConfig
  temperature?: number
  transport: AiStructuredOutputTransport
  streaming: boolean
  schema: z.ZodType<T>
  schemaName: string
  method: Exclude<NonScriptedStructuredOutputMethod, 'promptJson'>
}): TextRunnable => {
  const model = createTextRunnable({
    cfg: input.cfg,
    temperature: input.temperature,
    transport: input.transport,
    streaming: input.streaming
  })

  if (input.method === 'jsonMode') {
    return model.withConfig({
      outputVersion: 'v0',
      response_format: {
        type: 'json_object'
      }
    }) as TextRunnable
  }

  return model.withConfig({
    outputVersion: 'v0',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.schemaName,
        description: buildSchemaDescription(input.schema),
        schema: z.toJSONSchema(input.schema),
        strict: true
      }
    }
  }) as TextRunnable
}

const invokeTextWithTransport = async (
  transport: AiStructuredOutputTransport,
  input: AiLlmTextInvocationInput & {
    checkCancelled: () => void
  }
): Promise<AiLlmTextDriverResult> => {
  const streaming = input.streamingMode === 'force_stream'
  const providerKind = resolveConfigProviderKind(input.cfg)
  const runnable = createTextRunnable({
    cfg: input.cfg,
    temperature: input.temperature,
    transport,
    streaming
  })
  const messages = buildMessages(input.system, input.user)
  const response = streaming
    ? await streamTextFromRunnable({
        runnable,
        messages,
        observer: input.observer,
        checkCancelled: input.checkCancelled,
        signal: input.signal
      })
    : await invokeTextFromRunnable({
        runnable,
        messages,
        checkCancelled: input.checkCancelled,
        signal: input.signal
      })
  const metadata = toInvocationMetadata({
    message: response.message,
    providerKind
  })
  return {
    output: response.text,
    rawText: response.text,
    transport,
    streamed: streaming,
    ...metadata
  }
}

type StructuredOutputRawTextError = Error & {
  rawText?: string
}

const withRawText = (error: unknown, rawText: string): StructuredOutputRawTextError => {
  const next: StructuredOutputRawTextError =
    error instanceof Error ? (error as StructuredOutputRawTextError) : new Error(String(error))
  next.rawText = rawText
  return next
}

const getRawTextFromError = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const rawText = (error as { rawText?: unknown }).rawText
  return typeof rawText === 'string' && rawText ? rawText : undefined
}

const isStructuredParseFailure = (error: unknown): boolean => {
  if (error instanceof SyntaxError) return true
  const message = error instanceof Error ? error.message : String(error || '')
  return (
    message.includes('structured_output_empty_response') ||
    message.includes('prompt_json_empty_response') ||
    message.includes('structured_output_non_object_response') ||
    message.includes('prompt_json_non_object_response') ||
    message.includes('JSON') ||
    message.includes('Expected') ||
    message.includes('Unexpected')
  )
}

const resolveResultStrategy = (input: {
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  structuredOutputMode?: StructuredOutputMode
  strategy?: StructuredOutputStrategy
}): StructuredOutputStrategy | undefined => {
  if (input.strategy) return input.strategy
  if (!input.transport || input.method === 'scripted') return undefined
  return {
    transport: input.transport,
    mode: input.structuredOutputMode || methodToStructuredOutputMode(input.method)
  }
}

const isCancellationError = (error: unknown): boolean => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase()
  return code === 'CANCELLED' || message.includes('cancel')
}

export const classifyLlmCallRetry = (
  error: unknown,
  attempt = 1
): { retryable: boolean; message: string; delayMs?: number } => {
  if (isLlmProviderError(error)) {
    return {
      retryable: error.retryable,
      message: error.message,
      ...(isResourceExhaustedError(error)
        ? { delayMs: resolveResourceExhaustedDelay(attempt) }
        : {})
    }
  }
  const info = normalizeStructuredOutputError(error)
  const message = info.message || getErrorText(error)
  const body = `${info.rawText} ${error instanceof Error ? error.message : ''}`.toLowerCase()
  if (isCancellationError(error)) return { retryable: false, message }
  if (body.includes('structured_output_retryable') || body.includes('text_output_retryable')) {
    return { retryable: true, message }
  }
  const retryableStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504])
  if (info.status !== undefined && retryableStatus.has(info.status)) {
    return {
      retryable: true,
      message,
      ...(isResourceExhaustedError(error, `${info.rawText} ${info.code} ${info.message}`)
        ? { delayMs: resolveResourceExhaustedDelay(attempt) }
        : {})
    }
  }
  const code = String(info.code || '').toLowerCase()
  if (
    code === 'timeout' ||
    code === 'request_timeout' ||
    code === 'rate_limit_exceeded' ||
    code === 'server_error' ||
    code === 'service_unavailable'
  ) {
    return { retryable: true, message }
  }
  if (
    body.includes('network') ||
    body.includes('econnreset') ||
    body.includes('etimedout') ||
    body.includes('timed out') ||
    body.includes('timeout') ||
    body.includes('rate limit') ||
    body.includes('temporarily unavailable') ||
    body.includes('service unavailable')
  ) {
    return { retryable: true, message }
  }
  return { retryable: false, message }
}

const isResourceExhaustedError = (error: unknown, extraText = ''): boolean => {
  const message = `${error instanceof Error ? error.message : String(error || '')} ${extraText}`
  return /resourceexhausted|worker local total request limit/i.test(message)
}

const resolveResourceExhaustedDelay = (attempt: number): number =>
  Math.min(15_000, 2_000 * 2 ** Math.max(0, attempt - 1))

const createLlmProviderError = (error: unknown, retryable: boolean): LlmProviderError => {
  if (isLlmProviderError(error)) return error
  const info = normalizeStructuredOutputError(error)
  return new LlmProviderError({
    message: info.message || '模型服务请求失败。',
    httpStatus: info.status,
    providerCode: info.code,
    providerType: info.type,
    retryable,
    cause: error
  })
}

const invokeStructuredWithStrategy = async <T extends Record<string, unknown>>(
  strategy: StructuredOutputStrategy,
  input: AiLlmStructuredInvocationInput<T> & {
    checkCancelled: () => void
  }
): Promise<AiLlmStructuredDriverResult> => {
  const { method, transport } = resolveStructuredOutputStrategy(strategy)
  const streaming = input.streamingMode === 'force_stream'
  const providerKind = resolveConfigProviderKind(input.cfg)
  const messages = buildMessages(input.system, input.user)

  if (method === 'promptJson') {
    const runnable = createTextRunnable({
      cfg: input.cfg,
      temperature: input.temperature,
      transport,
      streaming
    })
    const response = streaming
      ? await streamTextFromRunnable({
          runnable,
          messages,
          observer: input.observer,
          checkCancelled: input.checkCancelled,
          signal: input.signal
        })
      : await invokeTextFromRunnable({
          runnable,
          messages,
          checkCancelled: input.checkCancelled,
          signal: input.signal
        })
    const metadata = toInvocationMetadata({
      message: response.message,
      providerKind
    })
    let output: Record<string, unknown>
    try {
      output = parsePromptJsonOutput(response.text)
    } catch (error) {
      throw withRawText(error, response.text)
    }
    return {
      output,
      rawText: response.text,
      method: 'promptJson',
      transport,
      structuredOutputMode: strategy.mode,
      strategy,
      streamed: streaming,
      ...metadata
    }
  }

  const runnable = createStructuredJsonRunnable({
    cfg: input.cfg,
    temperature: input.temperature,
    transport,
    streaming,
    schema: input.schema,
    schemaName: input.schemaName,
    method
  })
  const response = streaming
    ? await streamTextFromRunnable({
        runnable,
        messages,
        observer: input.observer,
        checkCancelled: input.checkCancelled,
        signal: input.signal
      })
    : await invokeTextFromRunnable({
        runnable,
        messages,
        checkCancelled: input.checkCancelled,
        signal: input.signal
      })
  const metadata = toInvocationMetadata({
    message: response.message,
    providerKind
  })
  let output: Record<string, unknown>
  try {
    output = parseJsonObjectText(response.text)
  } catch (error) {
    throw withRawText(error, response.text)
  }

  return {
    output,
    rawText: response.text,
    method,
    transport,
    structuredOutputMode: strategy.mode,
    strategy,
    streamed: streaming,
    ...metadata
  }
}

const invokeStructuredChatNative = async <T extends Record<string, unknown>>(
  input: AiLlmStructuredInvocationInput<T> & {
    checkCancelled: () => void
  }
): Promise<AiLlmStructuredDriverResult> => {
  const attemptOrder = buildStructuredAttemptOrder(input.preferredStrategy, input.cfg)
  const attemptedStrategies: StructuredOutputStrategy[] = []
  const strategyErrors: string[] = []
  let latestRawText: string | undefined
  let latestOutputError: unknown
  let latestCapacityError: unknown

  for (const strategy of attemptOrder) {
    const { method, transport } = resolveStructuredOutputStrategy(strategy)
    const strategyLabel = formatStructuredOutputStrategy(strategy)
    attemptedStrategies.push(strategy)
    try {
      const result = await invokeStructuredWithStrategy(strategy, input)
      let parsedOutput: T
      try {
        parsedOutput = input.schema.parse(result.output)
      } catch (error) {
        latestRawText = result.rawText || latestRawText
        latestOutputError = error
        strategyErrors.push(`${strategyLabel}: 模型返回内容不符合要求的结构`)
        continue
      }
      return {
        ...result,
        output: parsedOutput,
        fallbackStrategies: attemptedStrategies
      }
    } catch (error) {
      const reason = getErrorText(error)
      latestRawText = getRawTextFromError(error) || latestRawText
      const errorAnalysis = classifyStructuredOutputError({
        error,
        transport,
        method
      })
      if (errorAnalysis.kind === 'capability_mismatch') {
        strategyErrors.push(`${strategyLabel}: ${reason}`)
        continue
      }
      if (isStructuredParseFailure(error)) {
        strategyErrors.push(`${strategyLabel}: ${reason}`)
        latestOutputError = error
        continue
      }
      if (errorAnalysis.kind === 'retryable') {
        if (
          isResourceExhaustedError(
            error,
            `${errorAnalysis.info.rawText} ${errorAnalysis.info.code} ${errorAnalysis.info.message}`
          )
        ) {
          strategyErrors.push(`${strategyLabel}: ${reason}`)
          latestCapacityError = error
          continue
        }
        throw createLlmProviderError(error, true)
      }
      throw createLlmProviderError(error, false)
    }
  }

  if (latestCapacityError) {
    throw createLlmProviderError(latestCapacityError, true)
  }

  throw new LlmOutputError({
    message: '模型返回内容无法解析为要求的结构。',
    issues: [
      {
        path: 'output',
        message: strategyErrors.join(' | ') || '模型未返回可用的结构化内容'
      }
    ],
    rawText: latestRawText,
    cause: latestOutputError
  })
}

const invokeTextChatNative = async (
  input: AiLlmTextInvocationInput & {
    checkCancelled: () => void
  }
): Promise<AiLlmTextDriverResult> => {
  const attemptOrder = buildTransportAttemptOrder(input.preferredTransport, input.cfg)
  const transportErrors: string[] = []
  let latestCompatibilityError: unknown

  for (const transport of attemptOrder) {
    try {
      return await invokeTextWithTransport(transport, input)
    } catch (error) {
      const reason = getErrorText(error)
      if (isTransportCompatibilityError(transport, error)) {
        transportErrors.push(`${transport}: ${reason}`)
        latestCompatibilityError = error
        continue
      }
      if (classifyLlmCallRetry(error).retryable) {
        throw createLlmProviderError(error, true)
      }
      throw createLlmProviderError(error, false)
    }
  }

  throw createLlmProviderError(
    latestCompatibilityError ||
      new Error(transportErrors.join(' | ') || '模型服务不支持当前请求接口。'),
    false
  )
}

const runStructuredChatInvocation = async <T extends Record<string, unknown>>(input: {
  driver?: AiLlmDriver
  request: AiLlmStructuredInvocationInput<T> & {
    checkCancelled: () => void
  }
}): Promise<LlmCallExecutionResult<Record<string, unknown>>> => {
  if (input.driver?.chatStructured) {
    const result = await input.driver.chatStructured({
      caller: input.request.caller,
      cfg: input.request.cfg,
      preferredStrategy: input.request.preferredStrategy,
      schema: input.request.schema,
      schemaName: input.request.schemaName,
      system: input.request.system,
      user: input.request.user,
      temperature: input.request.temperature,
      streamingMode: input.request.streamingMode,
      observer: input.request.observer,
      signal: input.request.signal
    })
    const strategy = resolveResultStrategy(result)
    const fallbackStrategies =
      result.fallbackStrategies && result.fallbackStrategies.length > 0
        ? result.fallbackStrategies
        : strategy
          ? [strategy]
          : []
    return {
      output: result.output,
      rawText: result.rawText,
      method: result.method,
      transport: result.transport,
      structuredOutputMode: result.structuredOutputMode,
      strategy,
      fallbackStrategies,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  }

  return await invokeStructuredChatNative(input.request)
}

const invokeTextChat = async (input: {
  driver?: AiLlmDriver
  request: AiLlmTextInvocationInput & {
    checkCancelled: () => void
  }
}): Promise<LlmCallExecutionResult<string>> => {
  if (input.driver?.chatText) {
    const result = await input.driver.chatText(input.request)
    return {
      output: result.output,
      rawText: result.rawText ?? result.output,
      transport: result.transport,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  }

  return await invokeTextChatNative(input.request)
}

const persistConfigUpdate = async (input: {
  cfg: LlmRuntimeConfig
  nextConfig: LlmRuntimeConfig
  saveConfig: (cfg: LlmRuntimeConfig) => Promise<void>
  warningPrefix: string
}): Promise<void> => {
  const changed =
    input.cfg.preferredTransport !== input.nextConfig.preferredTransport ||
    input.cfg.preferredStructuredOutputMode !== input.nextConfig.preferredStructuredOutputMode
  if (!changed) return

  try {
    await input.saveConfig(input.nextConfig)
  } catch (error) {
    console.warn(input.warningPrefix, error)
  }
}

export const createAiLlmExecutor = (input: {
  eventCtx: AiEventDispatchContext
  runtimeSettings: AiRuntimeSettings
  getConfig: () => Promise<LlmRuntimeConfig>
  saveConfig: (cfg: LlmRuntimeConfig) => Promise<void>
  checkCancelled: () => void
  abortSignal?: AbortSignal
  driver?: AiLlmDriver
}): AiLlmExecutor => {
  const defaultStreamingMode = resolveStreamingMode(input.runtimeSettings)

  return {
    chatStructured: async <T extends Record<string, unknown>>(
      request: AiLlmStructuredRequest<T>
    ): Promise<{
      output: T
      usage?: AiLlmUsage
    }> => {
      input.checkCancelled()
      const streamingMode = request.streamingMode || defaultStreamingMode
      const cfg = await input.getConfig()
      const result = await runLlmCallWithActivity<T>({
        ctx: input.eventCtx,
        runId: input.eventCtx.runId,
        taskId: request.taskId,
        system: request.system,
        user: request.user,
        telemetry: {
          actionType: 'llm_structured_output',
          caller: request.caller,
          schemaName: request.schemaName,
          modelName: cfg.model_name,
          baseUrl: cfg.base_url,
          providerKind: resolveConfigProviderKind(cfg),
          streamingMode,
          attempt: 1,
          contextBudgetSnapshot: request.contextBudgetSnapshot
        },
        maxAttempts: AI_LLM_CALL_MAX_RETRY_ATTEMPTS,
        classifyRetry: classifyLlmCallRetry,
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) => {
              const invocation = await runStructuredChatInvocation({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
                  preferredStrategy: buildPreferredStrategy(cfg),
                  schema: request.schema,
                  schemaName: request.schemaName,
                  system: request.system,
                  user: request.user,
                  temperature: request.temperature,
                  streamingMode,
                  observer,
                  checkCancelled: input.checkCancelled,
                  signal
                }
              })
              try {
                return {
                  ...invocation,
                  output: request.schema.parse(invocation.output)
                }
              } catch (error) {
                throw toLlmOutputError(error, invocation.rawText || '')
              }
            }
          })
      })

      if (result.strategy) {
        await persistConfigUpdate({
          cfg,
          nextConfig: {
            ...cfg,
            preferredTransport: result.strategy.transport,
            preferredStructuredOutputMode: result.strategy.mode
          },
          saveConfig: input.saveConfig,
          warningPrefix: '[AI-LLM-EXECUTOR] Failed to persist structured preferences'
        })
      }

      return {
        output: result.output,
        usage: result.usage
      }
    },

    chatText: async (request: AiLlmTextRequest): Promise<string> => {
      input.checkCancelled()
      const streamingMode = request.streamingMode || defaultStreamingMode
      const cfg = await input.getConfig()
      const result = await runLlmCallWithActivity<string>({
        ctx: input.eventCtx,
        runId: input.eventCtx.runId,
        taskId: request.taskId,
        system: request.system,
        user: request.user,
        telemetry: {
          actionType: 'llm_text_output',
          caller: request.caller,
          schemaName: request.schemaName,
          modelName: cfg.model_name,
          baseUrl: cfg.base_url,
          providerKind: resolveConfigProviderKind(cfg),
          streamingMode,
          attempt: 1
        },
        onTextDelta: request.onTextDelta,
        maxAttempts: AI_LLM_CALL_MAX_RETRY_ATTEMPTS,
        classifyRetry: classifyLlmCallRetry,
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) =>
              await invokeTextChat({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
                  preferredTransport: cfg.preferredTransport,
                  schemaName: request.schemaName,
                  system: request.system,
                  user: request.user,
                  temperature: request.temperature,
                  streamingMode,
                  observer,
                  checkCancelled: input.checkCancelled,
                  signal
                }
              })
          })
      })

      if (result.transport) {
        await persistConfigUpdate({
          cfg,
          nextConfig: {
            ...cfg,
            preferredTransport: result.transport
          },
          saveConfig: input.saveConfig,
          warningPrefix: '[AI-LLM-EXECUTOR] Failed to persist text transport preference'
        })
      }

      return String(result.output || '')
    }
  }
}

export const invokeStructuredChat = async <T extends Record<string, unknown>>(
  input: InvokeStructuredChatInput<T>
): Promise<InvokeStructuredChatResult<T>> => {
  const result = await withAbortTimeout({
    timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
    execute: async (signal) =>
      await runStructuredChatInvocation({
        driver: input.driver,
        request: {
          caller: input.caller,
          cfg: input.cfg,
          preferredStrategy: input.preferredStrategy,
          schema: input.schema,
          schemaName: input.schemaName,
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          streamingMode:
            input.streamingMode === 'force_stream' ? 'force_stream' : 'force_non_stream',
          checkCancelled: () => undefined,
          signal
        }
      })
  })
  const method = result.method || 'scripted'
  const strategy = resolveResultStrategy({
    method,
    transport: result.transport,
    structuredOutputMode: result.structuredOutputMode,
    strategy: result.strategy
  })
  const fallbackStrategies =
    result.fallbackStrategies && result.fallbackStrategies.length > 0
      ? result.fallbackStrategies
      : strategy
        ? [strategy]
        : []

  let output: T
  try {
    output = input.schema.parse(result.output)
  } catch (error) {
    throw toLlmOutputError(error, result.rawText)
  }

  return {
    output,
    rawText: result.rawText,
    method,
    transport: result.transport,
    structuredOutputMode: result.structuredOutputMode,
    strategy,
    fallbackStrategies,
    streamed: result.streamed,
    usage: result.usage,
    responseMetadata: result.responseMetadata,
    usageMetadata: result.usageMetadata
  }
}

export { classifyLlmFailureCode }
