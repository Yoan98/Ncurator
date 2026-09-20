import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  collapseToolCallChunks,
  type BaseMessage,
  type ToolCallChunk
} from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { createChatModel } from '../llm/chatModel'
import { normalizeJsonObject, normalizeLlmUsage } from '../llm/usage'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import type {
  AiLlmUsage,
  AiLlmStreamingMode,
  BrainContextBudgetSnapshot,
  JsonObject,
  LLMConfig,
  LlmRuntimeConfig,
  LlmProviderKind
} from '../../../shared/types'
import type { AiEventDispatchContext } from './types'
import { AI_LLM_CALL_MAX_RETRY_ATTEMPTS, AI_LLM_CALL_TIMEOUT_MS } from './constants'
import { LlmProviderError, toLlmOutputError } from './errors'
import { classifyLlmRetry } from './llmRetry'
import {
  extractTextContent,
  parsePromptJsonOutput,
  serializeMessageContentForTelemetry
} from './structuredOutput'
import {
  runLlmCallWithActivity,
  type LlmCallExecutionResult,
  type LlmCallStreamObserver
} from './utils/structuredChatActivity'
import { serializeChatToolsRequestWire } from './utils/llmRequestWire'

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
  bindTools?: (tools: StructuredToolInterface[]) => TextRunnable
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
  retryOutputErrors?: boolean
}

export type AiLlmTextDriverResult = {
  output: string
  rawText?: string
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmTextMessagesDriverInput = {
  caller: string
  cfg: LlmRuntimeConfig
  schemaName: string
  messages: BaseMessage[]
  tools?: StructuredToolInterface[]
  temperature?: number
  streamingMode: AiLlmStreamingMode
  observer?: LlmCallStreamObserver
  signal?: AbortSignal
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
  chatMessages?: (input: AiLlmTextMessagesDriverInput) => Promise<AiLlmTextDriverResult>
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

export type AiLlmTextMessagesRequest = {
  caller: string
  taskId?: string
  schemaName: string
  messages: BaseMessage[]
  tools?: StructuredToolInterface[]
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
  retryOutputErrors?: boolean
}

export type AiLlmToolCallDriverInput = {
  caller: string
  cfg: LlmRuntimeConfig
  schemaName: string
  messages: BaseMessage[]
  tools: StructuredToolInterface[]
  temperature?: number
  streamingMode: AiLlmStreamingMode
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
  finishReason?: AiLlmFinishReason
}

export type AiLlmFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'resource_exhausted'
  | 'unknown'

export type AiLlmToolCallRequest = {
  caller: string
  taskId?: string
  messages: BaseMessage[]
  tools: StructuredToolInterface[]
  temperature?: number
  streamingMode?: AiLlmStreamingMode
  onTextDelta?: (text: string) => void
  onTextReset?: () => void
  onToolCallDelta?: () => void
  contextBudgetSnapshot?: BrainContextBudgetSnapshot
}

export type AiLlmToolCallResult = {
  message: AIMessage
  usage?: AiLlmUsage
  finishReason: AiLlmFinishReason
}

export type AiLlmExecutor = {
  chatStructured: <T extends Record<string, unknown>>(
    input: AiLlmStructuredRequest<T>
  ) => Promise<{
    output: T
    usage?: AiLlmUsage
  }>
  chatText: (input: AiLlmTextRequest) => Promise<string>
  chatMessages: (input: AiLlmTextMessagesRequest) => Promise<string>
  chatTools: (input: AiLlmToolCallRequest) => Promise<AiLlmToolCallResult>
}

const resolveStreamingMode = (mode?: AiLlmStreamingMode): AiLlmStreamingMode =>
  mode === 'force_non_stream' ? 'force_non_stream' : 'force_stream'

const buildMessages = (system: string, user: string): Array<SystemMessage | HumanMessage> => [
  new SystemMessage(system),
  new HumanMessage(user)
]

const MAX_CONSECUTIVE_BLANK_STREAM_CHUNKS = 512
const MAX_CONSECUTIVE_BLANK_STREAM_MS = 120_000

const createRunnableConfig = (signal?: AbortSignal): Partial<RunnableConfig> | undefined =>
  signal ? { signal } : undefined

const createCancelledError = (): Error & { code: string } => {
  const error = new Error('已取消') as Error & { code: string }
  error.code = 'CANCELLED'
  return error
}

const listenForAbort = (signal: AbortSignal, onAbort: () => void): (() => void) => {
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  return () => signal.removeEventListener('abort', onAbort)
}

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
      const cancelledError = createCancelledError()
      controller.abort(cancelledError)
      reject(cancelledError)
    }
    cleanupAbortListener = listenForAbort(input.externalSignal, onAbort)
  })

  try {
    const result = await Promise.race([
      input.execute(controller.signal),
      timeoutPromise,
      externalAbortPromise
    ])
    if (input.externalSignal?.aborted) throw createCancelledError()
    return result
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    cleanupAbortListener?.()
  }
}

const nextWithAbort = async <T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal
): Promise<IteratorResult<T>> => {
  if (!signal) return await iterator.next()
  if (signal.aborted) throw createCancelledError()
  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => reject(createCancelledError())
    const stop = listenForAbort(signal, onAbort)
    void iterator.next().then(
      (result) => {
        stop()
        resolve(result)
      },
      (error) => {
        stop()
        reject(error)
      }
    )
  })
}

const iterateWithAbort = async function* <T>(
  iterable: AsyncIterable<T>,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]()
  try {
    for (;;) {
      const result = await nextWithAbort(iterator, signal)
      if (result.done) return
      yield result.value
    }
  } finally {
    void iterator.return?.()?.then(
      () => undefined,
      () => undefined
    )
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

const normalizeFinishReason = (value: unknown): AiLlmFinishReason => {
  const reason = String(value || '').trim().toLowerCase()
  if (reason === 'stop' || reason === 'end_turn' || reason === 'completed') return 'stop'
  if (reason === 'tool_calls' || reason === 'tool_call' || reason === 'tool_use') {
    return 'tool_calls'
  }
  if (reason === 'length' || reason === 'max_tokens') return 'length'
  if (reason === 'content_filter' || reason === 'filtered') return 'content_filter'
  if (reason === 'resource_exhausted' || reason === 'resourceexhausted') {
    return 'resource_exhausted'
  }
  return 'unknown'
}

const resolveFinishReason = (input: {
  explicit?: unknown
  responseMetadata?: JsonObject
  hasToolCalls: boolean
}): AiLlmFinishReason => {
  const metadata = input.responseMetadata
  const fromProvider = normalizeFinishReason(
    input.explicit ?? metadata?.finish_reason ?? metadata?.stop_reason
  )
  if (fromProvider !== 'unknown') return fromProvider
  // 没有 finish_reason 时，只有在完整 stream/invoke 已正常关闭后才会走到这里。
  return input.hasToolCalls ? 'tool_calls' : 'stop'
}

const assertFinishReasonIsUsable = (finishReason: AiLlmFinishReason): void => {
  if (finishReason !== 'resource_exhausted') return
  throw new LlmProviderError({
    message: '模型服务资源暂时不可用，请稍后重试。',
    providerCode: 'resource_exhausted',
    retryable: true
  })
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
  for await (const chunk of iterateWithAbort(stream, input.signal)) {
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

/** @deprecated Prefer classifyLlmRetry from llmRetry.ts */
export const classifyLlmCallRetry = classifyLlmRetry

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

const invokeTextMessagesChat = async (input: {
  driver?: AiLlmDriver
  request: AiLlmTextMessagesDriverInput & {
    checkCancelled: () => void
  }
}): Promise<LlmCallExecutionResult<string>> => {
  if (input.driver?.chatMessages) {
    const result = await input.driver.chatMessages(input.request)
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
  const baseRunnable = createTextRunnable({
    cfg: request.cfg,
    temperature: request.temperature,
    streaming
  })
  // 需要共享 prompt 缓存的调用会传入与 brain 相同的 tools，
  // 使工具描述被渲染进 prompt 从而命中 DeepSeek 的 KV 缓存前缀，同时保持流式输出。
  const runnable =
    request.tools && request.tools.length > 0 && baseRunnable.bindTools
      ? baseRunnable.bindTools(request.tools)
      : baseRunnable
  const response = streaming
    ? await streamTextFromRunnable({
        runnable,
        messages: request.messages as Array<SystemMessage | HumanMessage>,
        observer: request.observer,
        checkCancelled: request.checkCancelled,
        signal: request.signal
      })
    : await invokeTextFromRunnable({
        runnable,
        messages: request.messages as Array<SystemMessage | HumanMessage>,
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
    throw toLlmOutputError(error, response.text, request.retryOutputErrors)
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
    stream: (
      input: BaseMessage[],
      config?: Partial<RunnableConfig>
    ) => Promise<AsyncIterable<AIMessageChunk>>
  }
}

const streamToolCallingCore = async (input: {
  request: AiLlmToolCallDriverInput
  checkCancelled: () => void
}): Promise<LlmCallExecutionResult<AIMessage>> => {
  const request = input.request
  const providerKind = resolveConfigProviderKind(request.cfg)
  const runnable = createChatModel(request.cfg, {
    temperature: request.temperature ?? 0.2,
    streaming: true,
    timeout: AI_LLM_CALL_TIMEOUT_MS
  }) as ToolCallingModel
  const bound = runnable.bindTools(request.tools)
  const stream = await bound.stream(request.messages, createRunnableConfig(request.signal))
  const textChunks: string[] = []
  const toolCallChunks: ToolCallChunk[] = []
  let lastChunk: AIMessageChunk | undefined
  for await (const chunk of iterateWithAbort(stream, request.signal)) {
    input.checkCancelled()
    lastChunk = chunk
    const text = extractTextContent(chunk.content)
    if (text) {
      textChunks.push(text)
      request.observer?.onDelta?.(text)
    }
    if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
      request.observer?.onToolCallDelta?.()
      toolCallChunks.push(...chunk.tool_call_chunks)
    }
  }
  const collapsed = collapseToolCallChunks(toolCallChunks)
  const rawText = textChunks.join('')
  const message = new AIMessage({
    content: rawText,
    tool_calls: collapsed.tool_calls,
    invalid_tool_calls: collapsed.invalid_tool_calls
  })
  const metadata = toInvocationMetadata({
    message: lastChunk,
    providerKind
  })
  const finishReason = resolveFinishReason({
    responseMetadata: metadata.responseMetadata,
    hasToolCalls:
      collapsed.tool_calls.length > 0 || collapsed.invalid_tool_calls.length > 0
  })
  assertFinishReasonIsUsable(finishReason)
  return {
    output: message,
    rawText,
    streamed: true,
    finishReason,
    ...metadata
  }
}

const invokeToolCallingCore = async (input: {
  driver?: AiLlmDriver
  request: AiLlmToolCallDriverInput
  checkCancelled: () => void
}): Promise<LlmCallExecutionResult<AIMessage>> => {
  if (input.driver?.chatTools) {
    const result = await input.driver.chatTools(input.request)
    const finishReason = resolveFinishReason({
      explicit: result.finishReason,
      responseMetadata: result.responseMetadata,
      hasToolCalls:
        Boolean(result.message.tool_calls?.length) ||
        Boolean(result.message.invalid_tool_calls?.length)
    })
    assertFinishReasonIsUsable(finishReason)
    return {
      output: result.message,
      rawText: result.rawText,
      streamed: result.streamed,
      usage: result.usage,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata,
      finishReason
    }
  }

  if (input.request.streamingMode === 'force_stream') {
    return await streamToolCallingCore({
      request: input.request,
      checkCancelled: input.checkCancelled
    })
  }

  const request = input.request
  const providerKind = resolveConfigProviderKind(request.cfg)
  const runnable = createChatModel(request.cfg, {
    temperature: request.temperature ?? 0.2,
    streaming: false,
    timeout: AI_LLM_CALL_TIMEOUT_MS
  }) as ToolCallingModel
  const bound = runnable.bindTools(request.tools)
  const response = await bound.invoke(request.messages, createRunnableConfig(request.signal))
  const text = extractTextContent(response.content)
  const metadata = toInvocationMetadata({
    message: response,
    providerKind
  })
  const finishReason = resolveFinishReason({
    responseMetadata: metadata.responseMetadata,
    hasToolCalls:
      Boolean(response.tool_calls?.length) || Boolean(response.invalid_tool_calls?.length)
  })
  assertFinishReasonIsUsable(finishReason)
  return {
    output: response,
    rawText: text,
    streamed: false,
    finishReason,
    ...metadata
  }
}

export const createAiLlmExecutor = (input: {
  eventCtx: AiEventDispatchContext
  defaultStreamingMode?: AiLlmStreamingMode
  getConfig: () => Promise<LlmRuntimeConfig>
  saveConfig: (cfg: LlmRuntimeConfig) => Promise<void>
  checkCancelled: () => void
  abortSignal?: AbortSignal
  driver?: AiLlmDriver
}): AiLlmExecutor => {
  const defaultStreamingMode = resolveStreamingMode(input.defaultStreamingMode)

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
        classifyRetry: classifyLlmRetry,
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
                  signal,
                  retryOutputErrors: request.retryOutputErrors
                }
              })
              try {
                return {
                  ...invocation,
                  output: request.schema.parse(invocation.output)
                }
              } catch (error) {
                throw toLlmOutputError(error, invocation.rawText || '', request.retryOutputErrors)
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
        classifyRetry: classifyLlmRetry,
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

    chatMessages: async (request: AiLlmTextMessagesRequest): Promise<string> => {
      input.checkCancelled()
      const streamingMode = request.streamingMode || defaultStreamingMode
      const cfg = await input.getConfig()
      const userHash = JSON.stringify(
        request.messages.map((message) => ({
          role: message.getType(),
          content: serializeMessageContentForTelemetry(message.content)
        }))
      )
      const result = await runLlmCallWithActivity<string>({
        ctx: input.eventCtx,
        runId: input.eventCtx.runId,
        taskId: request.taskId,
        system: '',
        user: userHash,
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
        classifyRetry: classifyLlmRetry,
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) =>
              await invokeTextMessagesChat({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
                  schemaName: request.schemaName,
                  messages: request.messages,
                  tools: request.tools,
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
      const streamingMode = request.streamingMode || defaultStreamingMode
      const systemHash = JSON.stringify(
        request.tools.map((tool) => ({
          name: String(tool.name || '').trim(),
          description: String(tool.description || '').trim()
        }))
      )
      const userHash = JSON.stringify(
        request.messages.map((message) => ({
          role: message.getType(),
          content: serializeMessageContentForTelemetry(message.content)
        }))
      )
      const requestWire = serializeChatToolsRequestWire({
        messages: request.messages,
        tools: request.tools
      })
      const result = await runLlmCallWithActivity<AIMessage>({
        ctx: input.eventCtx,
        runId: input.eventCtx.runId,
        taskId: request.taskId,
        system: systemHash,
        user: userHash,
        requestWire,
        telemetry: {
          actionType: 'llm_tool_calls',
          caller: request.caller,
          schemaName: 'human_brain_tool_calls',
          modelName: cfg.model_name,
          baseUrl: cfg.base_url,
          providerKind,
          streamingMode,
          attempt: 1,
          contextBudgetSnapshot: request.contextBudgetSnapshot
        },
        onTextDelta: request.onTextDelta,
        onTextReset: request.onTextReset,
        onToolCallDelta: request.onToolCallDelta,
        maxAttempts: AI_LLM_CALL_MAX_RETRY_ATTEMPTS,
        classifyRetry: classifyLlmRetry,
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) =>
              await invokeToolCallingCore({
                driver: input.driver,
                checkCancelled: input.checkCancelled,
                request: {
                  caller: request.caller,
                  cfg,
                  schemaName: 'human_brain_tool_calls',
                  messages: request.messages,
                  tools: request.tools,
                  temperature: request.temperature,
                  streamingMode,
                  observer,
                  signal
                }
              })
          })
      })

      return {
        message: result.output,
        usage: result.usage,
        finishReason: (result.finishReason as AiLlmFinishReason) || 'unknown'
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

export { classifyLlmRetry }
