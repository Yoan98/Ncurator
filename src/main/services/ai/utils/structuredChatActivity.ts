import { createHash, randomUUID } from 'node:crypto'
import { normalizeOpenAIBaseUrl } from '../../../../shared/llmBaseUrl'
import { emitActivity } from '../../../utils/aiCapabilityUtils'
import type { AiEventDispatchContext } from '../types'
import type {
  AiLlmStreamingMode,
  AiLlmUsage,
  AiStructuredOutputMethod,
  AiStructuredOutputProfile,
  AiStructuredOutputTransport,
  BrainContextBudgetSnapshot,
  JsonObject,
  JsonValue,
  LlmProviderKind
} from '../../../../shared/types'

export type LlmCallStreamObserver = {
  onStart?: () => void
  onDelta?: (text: string) => void
  onComplete?: (input: { rawText?: string }) => void
  onError?: (error: Error) => void
}

type LlmActionType = 'llm_structured_output' | 'llm_text_output'

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
  method?: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain?: AiStructuredOutputProfile[]
  streamed?: boolean
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
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
  telemetry: LlmCallTelemetry
  onTextDelta?: (text: string) => void
  execute: (observer: LlmCallStreamObserver, callId: string) => Promise<LlmCallExecutionResult<T>>
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
    const result = await input.execute(observer, callId)
    const durationMs = Date.now() - startedAt
    const fallbackChain =
      result.fallbackChain && result.fallbackChain.length > 0
        ? result.fallbackChain
        : result.profile
          ? [result.profile]
          : []
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
        method: result.method,
        transport: result.transport,
        profile: result.profile,
        fallbackChain,
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
      output: normalizeOutput(result.output),
      rawText,
      usage: result.usage,
      stablePrefixHash,
      dynamicContextHash,
      responseMetadata: result.responseMetadata,
      usageMetadata: result.usageMetadata,
      method: result.method,
      transport: result.transport,
      profile: result.profile,
      fallbackChain,
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
    const reason = error instanceof Error && error.message.trim() ? error.message.trim() : String(error || 'unknown')
    const normalizedError = error instanceof Error ? error : new Error(reason)
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
        reason
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
      rawText: latestRawText || undefined,
      stablePrefixHash,
      dynamicContextHash,
      fallbackChain: [],
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
    throw error
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
