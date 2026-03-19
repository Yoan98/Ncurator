import { randomUUID } from 'node:crypto'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  HumanActionSpec,
  HumanStepResultStatus,
  JsonObject,
  JsonValue,
  RuntimeSkillId
} from '../../../../../../shared/types'
import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../shared/state'

type ToolOutcome = {
  ok: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

type AiRunContextWithToolOverride = AiRunContext & {
  resolveToolExecutionOverride?: (input: {
    toolName: string
    args: JsonObject
  }) => ToolOutcome | undefined
}

const resolveResultStatus = (code: AiTaskResultCode, ok: boolean): HumanStepResultStatus => {
  if (ok && code === 'ok') return 'ok'
  if (code === 'workspace_required' || code === 'approval_denied' || code === 'bounded_loop_error') {
    return 'blocked'
  }
  return 'error'
}

const parseToolOutcome = (toolName: string, payload: JsonValue): ToolOutcome => {
  if (Array.isArray(payload)) {
    return {
      ok: true,
      code: 'ok',
      summary: `${toolName} returned ${payload.length} item(s)`,
      data: payload
    }
  }

  if (isJsonObject(payload)) {
    const codeValue = payload.code
    const code =
      codeValue === 'ok' ||
      codeValue === 'failed' ||
      codeValue === 'workspace_required' ||
      codeValue === 'approval_denied' ||
      codeValue === 'bounded_loop_error' ||
      codeValue === 'invalid_input'
        ? codeValue
        : payload.ok === false || payload.success === false
          ? 'failed'
          : 'ok'
    const summaryText =
      typeof payload.summary === 'string'
        ? payload.summary
        : typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : `${toolName} executed`
    return {
      ok: payload.ok !== false && payload.success !== false,
      code,
      summary: summaryText,
      data: payload
    }
  }

  if (typeof payload === 'string') {
    return {
      ok: true,
      code: 'ok',
      summary: payload.trim() || `${toolName} executed`,
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

const findActiveTool = (input: {
  toolName: string
  skillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): StructuredToolInterface | undefined => {
  for (const skillId of input.skillIds) {
    const tools = input.cache.toolsets[skillId] || []
    const matched = tools.find((tool) => String(tool.name || '').trim() === input.toolName)
    if (matched) return matched
  }
  return undefined
}

export const createToolInvoker = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  const ctxWithOverride = input.ctx as AiRunContextWithToolOverride

  return async (state: HumanState, action: Extract<HumanActionSpec, { type: 'invoke_tool' }>) => {
    const activeSkills = state.memory.capabilityFocus.activeStack
    const activeTool = findActiveTool({
      toolName: action.toolName,
      skillIds: activeSkills,
      cache: input.cache
    })

    if (!activeTool) {
      return {
        observation: {
          id: randomUUID(),
          kind: 'tool_result' as const,
          toolName: action.toolName,
          ok: false,
          code: 'invalid_input' as const,
          summary: `tool is not active: ${action.toolName}`
        },
        resultStatus: 'blocked' as const
      }
    }

    const injected = ctxWithOverride.resolveToolExecutionOverride?.({
      toolName: action.toolName,
      args: action.args
    })

    let outcome: ToolOutcome
    if (injected) {
      const toolCallId = randomUUID()
      input.ctx.sendEvent({
        type: 'tool_call_started',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolCallId,
        toolName: action.toolName,
        input: action.args,
        createdAt: Date.now(),
        stage: 'human_execute'
      })
      outcome = injected
      input.ctx.sendEvent({
        type: 'tool_call_result',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolCallId,
        toolName: action.toolName,
        outputPreview: outcome.data || {
          ok: outcome.ok,
          code: outcome.code,
          summary: outcome.summary
        },
        completedAt: Date.now(),
        error: outcome.ok ? undefined : outcome.summary,
        stage: 'human_execute'
      })
    } else {
      outcome = parseToolOutcome(action.toolName, (await activeTool.invoke(action.args)) as JsonValue)
    }

    return {
      observation: {
        id: randomUUID(),
        kind: 'tool_result' as const,
        toolName: action.toolName,
        ok: outcome.ok,
        code: outcome.code,
        summary: outcome.summary,
        data: outcome.data
      },
      resultStatus: resolveResultStatus(outcome.code, outcome.ok)
    }
  }
}
