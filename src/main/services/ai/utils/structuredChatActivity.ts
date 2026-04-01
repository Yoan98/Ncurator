import { randomUUID } from 'node:crypto'
import { normalizeOpenAIBaseUrl } from '../../../../shared/llmBaseUrl'
import { emitActivity } from '../../../utils/aiCapabilityUtils'
import type { AiEventDispatchContext } from '../types'
import type { AiStructuredOutputMethod, JsonValue } from '../../../../shared/types'

type StructuredChatTelemetry = {
  caller: string
  schemaName: string
  modelName: string
  baseUrl: string
  attempt?: number
}

export type StructuredChatExecutionResult<T> = {
  output: T
  method?: AiStructuredOutputMethod
  fallbackChain?: AiStructuredOutputMethod[]
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

const formatLlmActivitySummary = (input: {
  status: 'started' | 'completed' | 'failed'
  telemetry: StructuredChatTelemetry
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

export const runStructuredChatWithActivity = async <T>(input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  system: string
  user: string
  telemetry: StructuredChatTelemetry
  execute: () => Promise<StructuredChatExecutionResult<T>>
}): Promise<T> => {
  const startedAt = Date.now()
  const baseUrlHost = resolveBaseUrlHost(input.telemetry.baseUrl)
  const callId = randomUUID()
  const details = {
    callId,
    caller: input.telemetry.caller,
    schemaName: input.telemetry.schemaName,
    model: input.telemetry.modelName,
    baseUrlHost,
    attempt: input.telemetry.attempt || 1
  }

  const normalizeOutput = (value: T): JsonValue | undefined => {
    try {
      return JSON.parse(JSON.stringify(value)) as JsonValue
    } catch {
      return undefined
    }
  }

  emitActivity({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    actionType: 'llm_structured_output',
    status: 'started',
    summary: formatLlmActivitySummary({
      status: 'started',
      telemetry: input.telemetry
    }),
    details
  })

  try {
    const result = await input.execute()
    const durationMs = Date.now() - startedAt
    const fallbackChain =
      result.fallbackChain && result.fallbackChain.length > 0
        ? result.fallbackChain
        : result.method
          ? [result.method]
          : []
    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: 'llm_structured_output',
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
        fallbackChain
      }
    })
    input.ctx.recordLlmIo?.({
      callId,
      runId: input.runId,
      taskId: input.taskId,
      caller: input.telemetry.caller,
      schemaName: input.telemetry.schemaName,
      model: input.telemetry.modelName,
      baseUrlHost,
      system: input.system,
      user: input.user,
      output: normalizeOutput(result.output),
      method: result.method,
      fallbackChain,
      startedAt,
      completedAt: startedAt + durationMs,
      durationMs,
      status: 'completed'
    })
    return result.output
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const reason = error instanceof Error && error.message.trim() ? error.message.trim() : String(error || 'unknown')
    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: 'llm_structured_output',
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
        reason
      }
    })
    input.ctx.recordLlmIo?.({
      callId,
      runId: input.runId,
      taskId: input.taskId,
      caller: input.telemetry.caller,
      schemaName: input.telemetry.schemaName,
      model: input.telemetry.modelName,
      baseUrlHost,
      system: input.system,
      user: input.user,
      fallbackChain: [],
      startedAt,
      completedAt: startedAt + durationMs,
      durationMs,
      status: 'failed',
      reason
    })
    throw error
  }
}
