import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { createChatModel } from '../llm/chatModel'
import { normalizeJsonObject, normalizeLlmUsage } from '../llm/usage'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import type {
  AiLlmUsage,
  AiLlmStreamingMode,
  AiRuntimeSettings,
  BrainContextBudgetSnapshot,
  JsonObject,
  LLMConfig,
  LlmRuntimeConfig,
  LlmProviderKind
} from '../../../shared/types'
import type { AiEventDispatchContext } from './types'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS, AI_LLM_CALL_TIMEOUT_MS } from './constants'
import { isLlmProviderError, toLlmOutputError } from './errors'
import { classifyLlmFailureCode } from './utils/runFailure'
import {
  extractTextContent,
  getErrorText,
  normalizeStructuredOutputError,
  parsePromptJsonOutput
} from './structuredOutput'
import {
  runLlmCallWithActivity,
  type LlmCallExecutionResult,
  type LlmCallStreamObserver
} from './utils/structuredChatActivity'

type TextMessage = {
  content: unknown
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

export type AiLlmTextInvocationInput = BaseLlmInvocationInput

type AiLlmStructuredDriverInput = BaseLlmInvocationInput & {
  schema: z.ZodType<Record<string, unknown>>
}

export type AiLlmTextDriverResult = {
  output: string
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmStructuredDriverResult = {
  output: Record<string, unknown>
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmDriver = {
  chatStructured?: (input: AiLlmStructuredDriverInput) => Promise<AiLlmStructuredDriverResult>
  chatText?: (input: AiLlmTextInvocationInput) => Promise<AiLlmTextDriverResult>
  chatTools?: (input: AiLlmToolCallDriverInput) => Promise<AiLlmToolCallDriverResult>
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

export type AiLlmToolCallDriverInput = {
  caller: string
  cfg: LlmRuntimeConfig
  schemaName: string
  messages: BaseMessage[]
  tools: StructuredToolInterface[]
  temperature?: number
  observer?: LlmCallStreamObserver
  signal?: AbortSignal
}

export type AiLlmToolCallDriverResult = {
  message: AIMessage
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmToolCallRequest = {
  caller: string
  taskId?: string
  messages: BaseMessage[]
  tools: StructuredToolInterface[]
  temperature?: number
  contextBudgetSnapshot?: BrainContextBudgetSnapshot
}

export type AiLlmToolCallResult = {
  message: AIMessage
  usage?: AiLlmUsage
}

export type AiLlmExecutor = {
  chatStructured: <T extends Record<string, unknown>>(
    input: AiLlmStructuredRequest<T>
  ) => Promise<{
    output: T
    usage?: AiLlmUsage
  }>
  chatText: (input: AiLlmTextRequest) => Promise<string>
  chatTools: (input: AiLlmToolCallRequest) => Promise<AiLlmToolCallResult>
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
  streaming: boolean
}): TextRunnable =>
  createChatModel(input.cfg, {
    temperature: input.temperature ?? 0.2,
    streaming: input.streaming,
    timeout: AI_LLM_CALL_TIMEOUT_MS
  }) as TextRunnable

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
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  }

  const request = input.request
  const streaming = request.streamingMode === 'force_stream'
  const providerKind = resolveConfigProviderKind(request.cfg)
  const runnable = createTextRunnable({
    cfg: request.cfg,
    temperature: request.temperature,
    streaming
  })
  const messages = buildMessages(request.system, request.user)
  const response = streaming
    ? await streamTextFromRunnable({
        runnable,
        messages,
        observer: request.observer,
        checkCancelled: request.checkCancelled,
        signal: request.signal
      })
    : await invokeTextFromRunnable({
        runnable,
        messages,
        checkCancelled: request.checkCancelled,
        signal: request.signal
      })
  const metadata = toInvocationMetadata({
    message: response.message,
    providerKind
  })
  return {
    output: response.text,
    rawText: response.text,
    streamed: streaming,
    ...metadata
  }
}

const invokeStructuredChatCore = async (input: {
  driver?: AiLlmDriver
  request: AiLlmStructuredDriverInput & {
    checkCancelled: () => void
  }
}): Promise<LlmCallExecutionResult<Record<string, unknown>>> => {
  if (input.driver?.chatStructured) {
    const result = await input.driver.chatStructured(input.request)
    return {
      output: result.output,
      rawText: result.rawText,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  }

  const request = input.request
  const streaming = request.streamingMode === 'force_stream'
  const providerKind = resolveConfigProviderKind(request.cfg)
  const runnable = createTextRunnable({
    cfg: request.cfg,
    temperature: request.temperature,
    streaming
  })
  const messages = buildMessages(request.system, request.user)
  const response = streaming
    ? await streamTextFromRunnable({
        runnable,
        messages,
        observer: request.observer,
        checkCancelled: request.checkCancelled,
        signal: request.signal
      })
    : await invokeTextFromRunnable({
        runnable,
        messages,
        checkCancelled: request.checkCancelled,
        signal: request.signal
      })
  const metadata = toInvocationMetadata({
    message: response.message,
    providerKind
  })
  let output: Record<string, unknown>
  try {
    output = parsePromptJsonOutput(response.text)
  } catch (error) {
    throw toLlmOutputError(error, response.text)
  }
  return {
    output,
    rawText: response.text,
    streamed: streaming,
    ...metadata
  }
}

type ToolCallingModel = {
  bindTools: (tools: StructuredToolInterface[]) => {
    invoke: (input: BaseMessage[], config?: Partial<RunnableConfig>) => Promise<AIMessage>
  }
}

const invokeToolCallingCore = async (input: {
  driver?: AiLlmDriver
  request: AiLlmToolCallDriverInput
}): Promise<LlmCallExecutionResult<AIMessage>> => {
  if (input.driver?.chatTools) {
    const result = await input.driver.chatTools(input.request)
    return {
      output: result.message,
      rawText: result.rawText,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata
    }
  }

  const request = input.request
  const providerKind = resolveConfigProviderKind(request.cfg)
  const runnable = createChatModel(request.cfg, {
    temperature: request.temperature ?? 0.2,
    streaming: false,
    timeout: AI_LLM_CALL_TIMEOUT_MS
  }) as unknown as ToolCallingModel
  const bound = runnable.bindTools(request.tools)
  const response = await bound.invoke(request.messages, createRunnableConfig(request.signal))
  const text = extractTextContent(response.content)
  const metadata = toInvocationMetadata({
    message: response,
    providerKind
  })
  return {
    output: response,
    rawText: text,
    streamed: false,
    ...metadata
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
              const invocation = await invokeStructuredChatCore({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
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

      return String(result.output || '')
    },

    chatTools: async (request: AiLlmToolCallRequest): Promise<AiLlmToolCallResult> => {
      input.checkCancelled()
      const cfg = await input.getConfig()
      const providerKind = resolveConfigProviderKind(cfg)
      const systemHash = JSON.stringify(
        request.tools.map((tool) => ({
          name: String(tool.name || '').trim(),
          description: String(tool.description || '').trim()
        }))
      )
      const userHash = JSON.stringify(
        request.messages.map((message) => ({
          role: message.getType(),
          content: extractTextContent(message.content)
        }))
      )
      const result = await runLlmCallWithActivity<AIMessage>({
        ctx: input.eventCtx,
        runId: input.eventCtx.runId,
        taskId: request.taskId,
        system: systemHash,
        user: userHash,
        telemetry: {
          actionType: 'llm_tool_calls',
          caller: request.caller,
          schemaName: 'human_brain_tool_calls',
          modelName: cfg.model_name,
          baseUrl: cfg.base_url,
          providerKind,
          streamingMode: 'force_non_stream',
          attempt: 1,
          contextBudgetSnapshot: request.contextBudgetSnapshot
        },
        maxAttempts: AI_LLM_CALL_MAX_RETRY_ATTEMPTS,
        classifyRetry: classifyLlmCallRetry,
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) =>
              await invokeToolCallingCore({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
                  schemaName: 'human_brain_tool_calls',
                  messages: request.messages,
                  tools: request.tools,
                  temperature: request.temperature,
                  observer,
                  signal
                }
              })
          })
      })

      return {
        message: result.output,
        usage: result.usage
      }
    }
  }
}

export const invokeStructuredChat = async <T extends Record<string, unknown>>(input: {
  caller: string
  cfg: LlmRuntimeConfig
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
  streamingMode?: AiLlmStreamingMode
}): Promise<{
  output: T
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
}> => {
  const result = await withAbortTimeout({
    timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
    execute: async (signal) =>
      await invokeStructuredChatCore({
        request: {
          caller: input.caller,
          cfg: input.cfg,
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

  let output: T
  try {
    output = input.schema.parse(result.output)
  } catch (error) {
    throw toLlmOutputError(error, result.rawText)
  }

  return {
    output,
    rawText: result.rawText,
    streamed: result.streamed,
    usage: result.usage
  }
}

export { classifyLlmFailureCode }
