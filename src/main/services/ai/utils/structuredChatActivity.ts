import { normalizeOpenAIBaseUrl } from '../../../../shared/llmBaseUrl'
import { emitActivity } from '../../../utils/aiCapabilityUtils'
import type { AiEventDispatchContext } from '../types'

type StructuredChatTelemetry = {
  caller: string
  schemaName: string
  modelName: string
  baseUrl: string
  attempt?: number
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
  telemetry: StructuredChatTelemetry
  execute: () => Promise<T>
}): Promise<T> => {
  const startedAt = Date.now()
  const baseUrlHost = resolveBaseUrlHost(input.telemetry.baseUrl)
  const details = {
    caller: input.telemetry.caller,
    schemaName: input.telemetry.schemaName,
    model: input.telemetry.modelName,
    baseUrlHost,
    attempt: input.telemetry.attempt || 1
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
    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: 'llm_structured_output',
      status: 'completed',
      summary: formatLlmActivitySummary({
        status: 'completed',
        telemetry: input.telemetry,
        durationMs: Date.now() - startedAt
      }),
      details: {
        ...details,
        durationMs: Date.now() - startedAt
      }
    })
    return result
  } catch (error) {
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
        durationMs: Date.now() - startedAt,
        reason
      }),
      details: {
        ...details,
        durationMs: Date.now() - startedAt,
        reason
      }
    })
    throw error
  }
}
