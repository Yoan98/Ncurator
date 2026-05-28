import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod/v4'
import { createChatModel, getSupportedTransportsForConfig } from '../llm/chatModel'
import { normalizeJsonObject, normalizeLlmUsage } from '../llm/usage'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import type {
  AiLlmUsage,
  AiRunFailureCode,
  AiLlmStreamingMode,
  AiRuntimeSettings,
  AiStructuredOutputMethod,
  AiStructuredOutputProfile,
  AiStructuredOutputTransport,
  BrainContextBudgetSnapshot,
  JsonObject,
  LLMConfig,
  LlmRuntimeConfig,
  LlmProviderKind,
  PreferredStructuredOutputProfile
} from '../../../shared/types'
import type { AiEventDispatchContext } from './types'
import { AI_LLM_CALL_TIMEOUT_MS } from './constants'
import { classifyLlmFailureCode } from './utils/runFailure'
import {
  buildStructuredOutputAttemptOrder,
  classifyStructuredOutputError,
  extractTextContent,
  getErrorText,
  getTransportBoundaryIndex,
  isTransportCompatibilityError,
  parseJsonObjectText,
  parsePromptJsonOutput,
  resolveResultProfile,
  resolveStructuredOutputProfile,
  type NonScriptedStructuredOutputMethod
} from './structuredOutput'
import { runLlmCallWithActivity, type LlmCallExecutionResult, type LlmCallStreamObserver } from './utils/structuredChatActivity'

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
  preferredProfile?: PreferredStructuredOutputProfile
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
  profile?: AiStructuredOutputProfile
  fallbackChain?: AiStructuredOutputProfile[]
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
}

export type AiLlmDriver = {
  chatStructured?: (
    input: AiLlmStructuredDriverInput
  ) => Promise<AiLlmStructuredDriverResult>
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
  preferredProfile?: PreferredStructuredOutputProfile
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
  profile: AiStructuredOutputProfile
  fallbackChain: AiStructuredOutputProfile[]
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
      const cancelledError = new Error('cancelled') as Error & { code?: string }
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
    return await Promise.race([input.execute(controller.signal), timeoutPromise, externalAbortPromise])
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

const buildStructuredAttemptOrder = (
  preferredProfile: PreferredStructuredOutputProfile | undefined,
  cfg: LlmRuntimeConfig
): PreferredStructuredOutputProfile[] => {
  const supportedTransports = new Set(getSupportedTransportsForConfig(cfg))
  return buildStructuredOutputAttemptOrder(preferredProfile).filter((profile) =>
    supportedTransports.has(resolveStructuredOutputProfile(profile).transport)
  )
}

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

const invokeStructuredWithProfile = async <T extends Record<string, unknown>>(
  profile: PreferredStructuredOutputProfile,
  input: AiLlmStructuredInvocationInput<T> & {
    checkCancelled: () => void
  }
): Promise<AiLlmStructuredDriverResult> => {
  const { method, transport } = resolveStructuredOutputProfile(profile)
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
    return {
      output: parsePromptJsonOutput(response.text),
      rawText: response.text,
      method: 'promptJson',
      transport,
      profile,
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

  return {
    output: parseJsonObjectText(response.text),
    rawText: response.text,
    method,
    transport,
    profile,
    streamed: streaming,
    ...metadata
  }
}

const buildStructuredOutputFailure = (input: {
  caller: string
  schemaName: string
  modelName: string
  profile: PreferredStructuredOutputProfile
  transport: AiStructuredOutputTransport
  method: NonScriptedStructuredOutputMethod
  reason: string
}) =>
  new Error(
    [
      'structured_output_failed',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.modelName}`,
      `profile=${input.profile}`,
      `transport=${input.transport}`,
      `method=${input.method}`,
      `reason=${input.reason}`
    ].join('; ')
  )

const buildStructuredOutputRetryableFailure = (input: {
  caller: string
  schemaName: string
  modelName: string
  profile: PreferredStructuredOutputProfile
  transport: AiStructuredOutputTransport
  method: NonScriptedStructuredOutputMethod
  reason: string
}) =>
  new Error(
    [
      'structured_output_retryable',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.modelName}`,
      `profile=${input.profile}`,
      `transport=${input.transport}`,
      `method=${input.method}`,
      `reason=${input.reason}`
    ].join('; ')
  )

const buildTextOutputFailure = (input: {
  caller: string
  schemaName: string
  modelName: string
  transport: AiStructuredOutputTransport
  reason: string
}) =>
  new Error(
    [
      'text_output_failed',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.modelName}`,
      `transport=${input.transport}`,
      `reason=${input.reason}`
    ].join('; ')
  )

const invokeStructuredChatNative = async <T extends Record<string, unknown>>(
  input: AiLlmStructuredInvocationInput<T> & {
    checkCancelled: () => void
  }
): Promise<AiLlmStructuredDriverResult> => {
  const attemptOrder = buildStructuredAttemptOrder(input.preferredProfile, input.cfg)
  const attemptedProfiles: PreferredStructuredOutputProfile[] = []
  const profileErrors: string[] = []

  for (let index = 0; index < attemptOrder.length; index += 1) {
    const profile = attemptOrder[index]
    const { method, transport } = resolveStructuredOutputProfile(profile)
    attemptedProfiles.push(profile)
    try {
      const result = await invokeStructuredWithProfile(profile, input)
      return {
        ...result,
        fallbackChain: attemptedProfiles
      }
    } catch (error) {
      const reason = getErrorText(error)
      const errorAnalysis = classifyStructuredOutputError({
        error,
        transport,
        method
      })
      if (errorAnalysis.kind === 'capability_mismatch' && errorAnalysis.transportCompatibility) {
        profileErrors.push(`${profile}: ${reason}`)
        index = getTransportBoundaryIndex(attemptOrder, index)
        continue
      }
      if (errorAnalysis.kind === 'capability_mismatch') {
        profileErrors.push(`${profile}: ${reason}`)
        continue
      }
      if (errorAnalysis.kind === 'retryable') {
        throw buildStructuredOutputRetryableFailure({
          caller: input.caller,
          schemaName: input.schemaName,
          modelName: input.cfg.model_name,
          profile,
          transport,
          method,
          reason
        })
      }
      throw buildStructuredOutputFailure({
        caller: input.caller,
        schemaName: input.schemaName,
        modelName: input.cfg.model_name,
        profile,
        transport,
        method,
        reason
      })
    }
  }

  throw new Error(
    [
      'structured_output_unsupported',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.cfg.model_name}`,
      `tried=${attemptedProfiles.join(' -> ')}`,
      `errors=${profileErrors.join(' | ') || 'unknown'}`
    ].join('; ')
  )
}

const invokeTextChatNative = async (
  input: AiLlmTextInvocationInput & {
    checkCancelled: () => void
  }
): Promise<AiLlmTextDriverResult> => {
  const attemptOrder = buildTransportAttemptOrder(input.preferredTransport, input.cfg)
  const transportErrors: string[] = []

  for (const transport of attemptOrder) {
    try {
      return await invokeTextWithTransport(transport, input)
    } catch (error) {
      const reason = getErrorText(error)
      if (isTransportCompatibilityError(transport, error)) {
        transportErrors.push(`${transport}: ${reason}`)
        continue
      }
      throw buildTextOutputFailure({
        caller: input.caller,
        schemaName: input.schemaName,
        modelName: input.cfg.model_name,
        transport,
        reason
      })
    }
  }

  throw new Error(
    [
      'text_output_unsupported',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.cfg.model_name}`,
      `tried=${attemptOrder.join(' -> ')}`,
      `errors=${transportErrors.join(' | ') || 'unknown'}`
    ].join('; ')
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
      preferredProfile: input.request.preferredProfile,
      schemaName: input.request.schemaName,
      system: input.request.system,
      user: input.request.user,
      temperature: input.request.temperature,
      streamingMode: input.request.streamingMode,
      observer: input.request.observer,
      signal: input.request.signal
    })
    const profile = resolveResultProfile(result)
    const fallbackChain =
      result.fallbackChain && result.fallbackChain.length > 0 ? result.fallbackChain : [profile]
    return {
      output: result.output,
      rawText: result.rawText,
      method: result.method,
      transport: result.transport,
      profile,
      fallbackChain,
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
    input.cfg.preferredStructuredOutputProfile !== input.nextConfig.preferredStructuredOutputProfile ||
    input.cfg.preferredTransport !== input.nextConfig.preferredTransport
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
      const result = await runLlmCallWithActivity<Record<string, unknown>>({
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
        execute: async (observer) =>
          await withAbortTimeout({
            timeoutMs: AI_LLM_CALL_TIMEOUT_MS,
            externalSignal: input.abortSignal,
            execute: async (signal) =>
              await runStructuredChatInvocation({
                driver: input.driver,
                request: {
                  caller: request.caller,
                  cfg,
                  preferredProfile: cfg.preferredStructuredOutputProfile,
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
          })
      })

      const resultProfile = result.profile
      if (resultProfile && resultProfile !== 'scripted') {
        const preferredTransport =
          result.transport || resolveStructuredOutputProfile(resultProfile).transport
        await persistConfigUpdate({
          cfg,
          nextConfig: {
            ...cfg,
            preferredStructuredOutputProfile: resultProfile,
            preferredTransport
          },
          saveConfig: input.saveConfig,
          warningPrefix: '[AI-LLM-EXECUTOR] Failed to persist structured preferences'
        })
      }

      return {
        output: request.schema.parse(result.output),
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
          preferredProfile: input.preferredProfile,
          schema: input.schema,
          schemaName: input.schemaName,
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          streamingMode: input.streamingMode === 'force_stream' ? 'force_stream' : 'force_non_stream',
          checkCancelled: () => undefined,
          signal
        }
      })
  })
  const method = result.method || 'scripted'
  const profile = resolveResultProfile({
    method,
    transport: result.transport,
    profile: result.profile
  })
  const fallbackChain =
    result.fallbackChain && result.fallbackChain.length > 0 ? result.fallbackChain : [profile]

  return {
    output: input.schema.parse(result.output),
    rawText: result.rawText,
    method,
    transport: result.transport,
    profile,
    fallbackChain,
    streamed: result.streamed,
    usage: result.usage,
    responseMetadata: result.responseMetadata,
    usageMetadata: result.usageMetadata
  }
}

export { classifyLlmFailureCode }
