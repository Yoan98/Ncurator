import { randomUUID } from 'node:crypto'
import { AIMessage, type ToolCall } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { AiTaskResultCode, JsonObject, JsonValue } from '../../../../../shared/types'
import { getMessageText, getToolNodeMessages, isJsonObject } from '../../../../utils/aiCapabilityUtils'
import type { AiRunContext } from '../../types'
import { appendHumanStepRecord, emitHumanStep } from './events'
import type { HumanRunState } from './types'

type ToolOutcome = {
  ok: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

const parseJsonValue = (text: string): JsonValue | null => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    const objectStart = trimmed.indexOf('{')
    const objectEnd = trimmed.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as JsonValue
      } catch {
        // fall through
      }
    }

    const arrayStart = trimmed.indexOf('[')
    const arrayEnd = trimmed.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1)) as JsonValue
      } catch {
        return null
      }
    }
  }

  return null
}

const resolveCode = (value: JsonValue | undefined, fallback: AiTaskResultCode): AiTaskResultCode => {
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

const toResultData = (value: JsonValue | undefined, key: string): JsonObject | undefined => {
  if (value === undefined) return undefined
  if (isJsonObject(value)) return value
  return { [key]: value }
}

const extractToolOutcome = (toolName: string, payload: JsonValue): ToolOutcome => {
  if (Array.isArray(payload)) {
    return {
      ok: true,
      code: 'ok',
      summary: `${toolName} returned ${payload.length} item(s)`,
      data: payload
    }
  }

  const payloadRecord: JsonObject | null = isJsonObject(payload || undefined)
    ? (payload as JsonObject)
    : null
  if (payloadRecord) {
    const ok = payloadRecord.ok !== false && payloadRecord.success !== false
    const code = resolveCode(payloadRecord.code, ok ? 'ok' : 'failed')
    const summary =
      String(
        payloadRecord.summary || payloadRecord.message || payloadRecord.error || `${toolName} executed`
      ).trim() || `${toolName} executed`
    return {
      ok,
      code,
      summary,
      data: payloadRecord
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return {
      ok: true,
      code: 'ok',
      summary: payload.trim(),
      data: payload
    }
  }

  return {
    ok: true,
    code: 'ok',
    summary: `${toolName} executed`,
    data: payload
  }
}

const buildToolCallMessage = (toolName: string, args: JsonObject): AIMessage => {
  const toolCall: ToolCall<string, JsonObject> = {
    id: randomUUID(),
    type: 'tool_call',
    name: toolName,
    args
  }
  return new AIMessage({
    content: '',
    tool_calls: [toolCall]
  })
}

const getActiveToolNames = (state: HumanRunState): string[] => {
  return state.activeTools
    .map((tool) => String(tool.name || '').trim())
    .filter(Boolean)
}

export const createHumanToolExecNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    ctx.checkCancelled()

    const decision = state.lastDecision
    const activeToolNames = getActiveToolNames(state)

    if (!decision || decision.action !== 'invoke_tool') {
      const summary = 'missing tool execution decision'
      const nextHistory = appendHumanStepRecord({
        history: state.stepHistory,
        step: state.steps,
        action: 'block_task',
        publicNarrative: '当前缺少可执行的工具决策，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        resultStatus: 'blocked',
        summary
      })

      emitHumanStep({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        publicNarrative: '当前缺少可执行的工具决策，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        summary,
        resultStatus: 'blocked',
        stage: 'human_tool_exec'
      })

      return {
        status: 'blocked',
        lastObservation: {
          kind: 'terminal',
          status: 'blocked',
          code: 'invalid_input',
          summary
        },
        stepHistory: nextHistory,
        summary,
        resultCode: 'invalid_input'
      }
    }

    if (!activeToolNames.includes(decision.toolName)) {
      const summary = `inactive tool execution: ${decision.toolName}`
      const nextHistory = appendHumanStepRecord({
        history: state.stepHistory,
        step: state.steps,
        action: 'block_task',
        publicNarrative: '当前工具未处于激活状态，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        resultStatus: 'blocked',
        summary
      })

      emitHumanStep({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        publicNarrative: '当前工具未处于激活状态，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        summary,
        resultStatus: 'blocked',
        stage: 'human_tool_exec'
      })

      return {
        status: 'blocked',
        lastObservation: {
          kind: 'terminal',
          status: 'blocked',
          code: 'invalid_input',
          summary,
          data: { toolName: decision.toolName }
        },
        stepHistory: nextHistory,
        summary,
        resultCode: 'invalid_input',
        resultData: { toolName: decision.toolName }
      }
    }

    let outcome: ToolOutcome

    try {
      const aiMessage = buildToolCallMessage(decision.toolName, decision.args)
      const out = await new ToolNode(state.activeTools).invoke({ messages: [aiMessage] })
      const toolMessages = getToolNodeMessages(out)
      if (toolMessages.length === 0) {
        outcome = {
          ok: false,
          code: 'invalid_input',
          summary: `tool execution produced no result: ${decision.toolName}`,
          data: { toolName: decision.toolName, args: decision.args }
        }
      } else {
      const lastToolMessage = toolMessages.at(-1)
        const text = getMessageText(lastToolMessage?.content).trim()
        if (!text) {
          outcome = {
            ok: false,
            code: 'invalid_input',
            summary: `tool execution returned empty content: ${decision.toolName}`,
            data: { toolName: decision.toolName, args: decision.args }
          }
        } else {
          const payload = parseJsonValue(text)
          if (payload === null) {
            outcome = {
              ok: false,
              code: 'invalid_input',
              summary: `tool execution returned unparseable content: ${decision.toolName}`,
              data: { raw: text }
            }
          } else {
            outcome = extractToolOutcome(decision.toolName, payload)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = {
        ok: false,
        code: 'failed',
        summary: message || `${decision.toolName} failed`,
        data: { error: message }
      }
    }

    const blocking = !outcome.ok && (
      outcome.code === 'workspace_required' || outcome.code === 'approval_denied'
    )
    const resultStatus = blocking ? 'blocked' : outcome.ok ? 'ok' : 'error'
    const lastObservation = {
      kind: 'tool_result' as const,
      toolName: decision.toolName,
      ok: outcome.ok,
      code: outcome.code,
      summary: outcome.summary,
      data: outcome.data
    }
    const nextHistory = appendHumanStepRecord({
      history: state.stepHistory,
      step: state.steps,
      action: 'invoke_tool',
      publicNarrative: decision.publicNarrative,
      activeSkillIds: state.activeSkillIds,
      activeToolNames,
      resultStatus,
      toolName: decision.toolName,
      summary: outcome.summary
    })

    emitHumanStep({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId,
      stepIndex: state.steps,
      action: 'invoke_tool',
      toolName: decision.toolName,
      publicNarrative: decision.publicNarrative,
      activeSkillIds: state.activeSkillIds,
      activeToolNames,
      summary: outcome.summary,
      resultStatus,
      stage: 'human_tool_exec'
    })

    if (blocking) {
      return {
        status: 'blocked',
        lastObservation: {
          kind: 'terminal',
          status: 'blocked',
          code: outcome.code,
          summary: outcome.summary,
          data: outcome.data
        },
        stepHistory: nextHistory,
        summary: outcome.summary,
        resultCode: outcome.code,
        resultData: toResultData(outcome.data, 'details')
      }
    }

    if (!outcome.ok) {
      return {
        phase: 'brain',
        lastObservation,
        stepHistory: nextHistory,
        summary: outcome.summary,
        resultCode: outcome.code,
        resultData: toResultData(outcome.data, 'details')
      }
    }

    return {
      phase: 'brain',
      lastObservation,
      stepHistory: nextHistory
    }
  }
}
