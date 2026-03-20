import { randomUUID } from 'node:crypto'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import type { JsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, RuntimeSkillId, ToolCallResult, ToolCallResultCode } from '../../types'
import { getAvailableToolNames } from '../learningNode/skillLoader'
import type { AiRunContextWithToolOverride } from './types'

const parseToolOutcome = (toolName: string, payload: JsonValue): ToolCallResult => {
  if (isJsonObject(payload)) {
    const codeValue = payload.code
    const code: ToolCallResultCode =
      codeValue === 'ok' ||
      codeValue === 'failed' ||
      codeValue === 'workspace_required' ||
      codeValue === 'approval_denied' ||
      codeValue === 'invalid_input'
        ? codeValue
        : payload.ok === false || payload.success === false
          ? 'failed'
          : 'ok'
    const summary =
      typeof payload.summary === 'string'
        ? payload.summary
        : typeof payload.error === 'string'
          ? payload.error
          : typeof payload.message === 'string'
            ? payload.message
            : `${toolName} executed`
    return {
      toolName,
      ok: payload.ok !== false && payload.success !== false,
      code,
      summary,
      data: payload
    }
  }

  if (typeof payload === 'string') {
    return {
      toolName,
      ok: true,
      code: 'ok',
      summary: payload.trim() || `${toolName} executed`,
      data: payload
    }
  }

  if (Array.isArray(payload)) {
    return {
      toolName,
      ok: true,
      code: 'ok',
      summary: `${toolName} returned ${payload.length} item(s)`,
      data: payload
    }
  }

  return {
    toolName,
    ok: true,
    code: 'ok',
    summary: `${toolName} executed`,
    data: payload
  }
}

const findTool = (input: {
  toolName: string
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): StructuredToolInterface | undefined => {
  for (const skillId of input.learnedSkillIds) {
    const matched = (input.cache.skillToolsets[skillId] || []).find(
      (tool) => String(tool.name || '').trim() === input.toolName
    )
    if (matched) return matched
  }
  return undefined
}

export const executeToolCall = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  learnedSkillIds: RuntimeSkillId[]
  toolName: string
  args: Record<string, JsonValue>
}): Promise<ToolCallResult> => {
  const ctxWithOverride = input.ctx as AiRunContextWithToolOverride
  const tool = findTool({
    toolName: input.toolName,
    learnedSkillIds: input.learnedSkillIds,
    cache: input.cache
  })
  if (!tool) {
    return {
      toolName: input.toolName,
      ok: false,
      code: 'invalid_input',
      summary: `当前未学习可执行工具 ${input.toolName}。`
    }
  }

  const injected = ctxWithOverride.resolveToolExecutionOverride?.({
    toolName: input.toolName,
    args: input.args
  })
  if (injected) {
    const toolCallId = randomUUID()
    input.ctx.sendEvent({
      type: 'tool_call_started',
      runId: input.ctx.runId,
      taskId: input.taskId,
      toolCallId,
      toolName: input.toolName,
      input: input.args,
      createdAt: Date.now(),
      stage: 'human_hand'
    })
    input.ctx.sendEvent({
      type: 'tool_call_result',
      runId: input.ctx.runId,
      taskId: input.taskId,
      toolCallId,
      toolName: input.toolName,
      outputPreview: injected.data || injected.summary,
      error: injected.ok ? undefined : injected.summary,
      completedAt: Date.now(),
      stage: 'human_hand'
    })
    return injected
  }

  try {
    const result = await tool.invoke(input.args)
    return parseToolOutcome(input.toolName, result as JsonValue)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      toolName: input.toolName,
      ok: false,
      code: 'invalid_input',
      summary: message
    }
  }
}

export const getLearnedToolNames = (input: {
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}) => getAvailableToolNames(input)
