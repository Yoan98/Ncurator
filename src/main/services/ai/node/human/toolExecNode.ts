import { ToolNode } from '@langchain/langgraph/prebuilt'
import { getMessageText, getToolNodeMessages } from '../../../../utils/aiCapabilityUtils'
import type { AiTaskResultCode, JsonObject, JsonValue } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRunState } from './types'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

const parseJsonObject = (text: string): JsonObject | null => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (isJsonObject(parsed as JsonValue)) return parsed as JsonObject
    return null
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (isJsonObject(parsed as JsonValue)) return parsed as JsonObject
      return null
    } catch {
      return null
    }
  }
}

const resolveCode = (value: JsonValue | undefined, fallback: AiTaskResultCode = 'ok') => {
  const raw = String(value || '').trim()
  if (
    raw === 'ok' ||
    raw === 'failed' ||
    raw === 'workspace_required' ||
    raw === 'approval_denied' ||
    raw === 'bounded_loop_error' ||
    raw === 'invalid_input'
  ) {
    return raw
  }
  return fallback
}

export const createHumanToolExecNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    if (!state.lastAiMessage || state.activeTools.length === 0 || !state.lastToolName) {
      const summary = 'missing tool execution context'
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        summary,
        createdAt: Date.now(),
        stage: 'human_tool_exec'
      })
      return {
        terminalState: 'blocked',
        summary,
        resultCode: 'invalid_input'
      }
    }

    const out = await new ToolNode(state.activeTools).invoke({ messages: [state.lastAiMessage] })
    const toolMessages = getToolNodeMessages(out)
    const mergedMessages = [...state.messages, ...toolMessages]
    const lastToolMessage = toolMessages.at(-1)
    const payload = parseJsonObject(getMessageText(lastToolMessage?.content)) || {}
    const toolName = state.lastToolName

    if (toolName === 'complete_task') {
      const summary = String(payload.summary || 'task completed').trim()
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'complete_task',
        toolName,
        summary,
        createdAt: Date.now(),
        stage: 'human_tool_exec'
      })
      return {
        messages: mergedMessages,
        terminalState: 'completed',
        summary,
        resultCode: 'ok',
        resultData: isJsonObject(payload.outputs as JsonValue | undefined)
          ? (payload.outputs as JsonObject)
          : undefined
      }
    }

    if (toolName === 'block_task') {
      const summary = String(payload.reason || 'task blocked').trim()
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        toolName,
        summary,
        createdAt: Date.now(),
        stage: 'human_tool_exec'
      })
      return {
        messages: mergedMessages,
        terminalState: 'blocked',
        summary,
        resultCode: 'failed',
        resultData:
          payload.details === undefined
            ? undefined
            : isJsonObject(payload.details as JsonValue)
              ? (payload.details as JsonObject)
              : { details: payload.details as JsonValue }
      }
    }

    const ok = payload.ok !== false && payload.success !== false
    const code = resolveCode(payload.code, ok ? 'ok' : 'failed')
    const summary =
      String(payload.summary || payload.message || payload.error || `${toolName} executed`).trim() ||
      `${toolName} executed`

    ctx.sendEvent({
      type: 'human_step',
      runId: state.runId,
      taskId: state.input.taskId,
      stepIndex: state.steps,
      action: 'invoke_tool',
      toolName,
      summary,
      createdAt: Date.now(),
      stage: 'human_tool_exec'
    })

    if (!ok) {
      return {
        messages: mergedMessages,
        terminalState: 'blocked',
        summary,
        resultCode: code,
        resultData: payload
      }
    }

    return {
      messages: mergedMessages,
      phase: 'brain'
    }
  }
}
