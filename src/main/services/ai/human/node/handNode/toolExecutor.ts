import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, RuntimeSkillId, ToolCallResult } from '../../types'
import { normalizeToolCallResult } from '../../utils/toolResult'
import type { AiRunContextWithHumanOverrides } from '../types'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'

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
  const ctxWithOverride = input.ctx as AiRunContextWithHumanOverrides
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
    const toolCallId = emitToolCallStarted({
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: input.taskId,
      toolName: input.toolName,
      args: input.args,
      stage: 'human_hand'
    })
    emitToolCallResult({
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: input.taskId,
      toolCallId,
      toolName: input.toolName,
      outputPreview: injected.data || injected.summary,
      error: injected.ok ? undefined : injected.summary,
      stage: 'human_hand'
    })
    return injected
  }

  try {
    const result = await tool.invoke(input.args)
    return normalizeToolCallResult(input.toolName, result as JsonValue)
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
