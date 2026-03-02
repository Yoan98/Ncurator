import { randomUUID } from 'node:crypto'
import { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { AiPlanTask, AiRunContext, AiRunState } from '../services/ai/types'
import type { AiTaskResultCode, JsonObject, JsonValue } from '../../shared/types'

type MessageContent = BaseMessage['content'] | undefined

export type ToolNodeInvokeResult = { messages?: BaseMessage[] }

export type CapabilityExecutor = (
  ctx: AiRunContext,
  state: AiRunState,
  task: AiPlanTask
) => Promise<Partial<AiRunState>>

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

export const markTaskFailed = (
  ctx: AiRunContext,
  state: AiRunState,
  taskId: string,
  error: string,
  code: AiTaskResultCode = 'failed',
  data?: JsonObject
): Partial<AiRunState> => {
  const plan = (state.plan || []).map((t) =>
    t.id === taskId
      ? {
          ...t,
          attempts: Number(t.attempts || 0) + 1,
          status: 'failed' as const,
          error,
          resultCode: code,
          resultMessage: error,
          resultData: data
        }
      : t
  )
  ctx.sendEvent({ type: 'task_failed', runId: state.runId, taskId, error })
  ctx.sendEvent({
    type: 'task_result',
    runId: state.runId,
    taskId,
    code,
    message: error,
    data
  })
  emitActivity({
    ctx,
    runId: state.runId,
    taskId,
    actionType: 'task',
    status: 'failed',
    summary: error
  })
  return {
    plan,
    activeTaskId: undefined,
    error,
    outputText: error
  }
}

export const completeTask = (input: {
  ctx: AiRunContext
  state: AiRunState
  task: AiPlanTask
  code?: AiTaskResultCode
  message?: string
  data?: JsonObject
  outputText?: string
}): Partial<AiRunState> => {
  const code = input.code || 'ok'
  const plan = (input.state.plan || []).map((taskItem) =>
    taskItem.id === input.task.id
      ? {
          ...taskItem,
          attempts: Number(taskItem.attempts || 0) + 1,
          status: 'completed' as const,
          error: undefined,
          resultCode: code,
          resultMessage: input.message,
          resultData: input.data
        }
      : taskItem
  )
  input.ctx.sendEvent({ type: 'task_completed', runId: input.state.runId, taskId: input.task.id })
  input.ctx.sendEvent({
    type: 'task_result',
    runId: input.state.runId,
    taskId: input.task.id,
    code,
    message: input.message,
    data: input.data
  })
  return {
    plan,
    activeTaskId: undefined,
    outputText: input.outputText || input.message || input.state.outputText
  }
}

export const resolveTaskObjective = (state: AiRunState, task: AiPlanTask): string => {
  if (task.toolInput?.kind === 'terminal_exec' || task.toolInput?.kind === 'docx') {
    return String(task.toolInput.objective || '').trim()
  }
  if (task.toolInput?.kind === 'local_kb_retrieval') {
    return String(task.toolInput.objective || '').trim()
  }
  return String(task.input || task.title || state.input || '').trim()
}

export type JsonTaskResult = {
  satisfied?: boolean
  note?: string
}

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}
