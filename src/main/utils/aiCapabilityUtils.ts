import { randomUUID } from 'node:crypto'
import { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../services/ai/types'
import type { JsonObject, JsonValue } from '../../shared/types'

type MessageContent = BaseMessage['content'] | undefined

export type ToolNodeInvokeResult = { messages?: BaseMessage[] }

export const getToolNodeMessages = (value: ToolNodeInvokeResult): BaseMessage[] => {
  const raw = value.messages
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is BaseMessage => item instanceof BaseMessage)
}

export const parseJsonObject = <T extends JsonObject>(text: string): T => {
  const trimmed = String(text || '').trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    void err
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1)
    return JSON.parse(slice) as T
  }
  throw new Error('无法解析 JSON 输出')
}

export const getMessageText = (content: MessageContent): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  return content
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk
      if ('text' in chunk && typeof chunk.text === 'string') return chunk.text
      return ''
    })
    .join('\n')
}

export const getToolCalls = (message: AIMessage) => {
  return Array.isArray(message.tool_calls) ? message.tool_calls : []
}

export const emitActivity = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}) => {
  input.ctx.sendEvent({
    type: 'activity',
    runId: input.runId,
    taskId: input.taskId,
    activityId: randomUUID(),
    actionType: input.actionType,
    status: input.status,
    summary: input.summary,
    createdAt: Date.now()
  })
}

export type JsonTaskResult = {
  satisfied?: boolean
  note?: string
}

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}
