import { randomUUID } from 'node:crypto'
import { AIMessage } from '@langchain/core/messages'
import type { AiEventDispatchContext } from '../services/ai/types'
import type { AiActivityDetails, JsonObject, JsonValue } from '../../shared/types'

export const getToolCalls = (message: AIMessage) => {
  return Array.isArray(message.tool_calls) ? message.tool_calls : []
}

export const emitActivity = (input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
  details?: AiActivityDetails
}) => {
  input.ctx.sendEvent({
    type: 'activity',
    runId: input.runId,
    taskId: input.taskId,
    activityId: randomUUID(),
    actionType: input.actionType,
    status: input.status,
    summary: input.summary,
    details: input.details,
    createdAt: Date.now()
  })
}

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}
