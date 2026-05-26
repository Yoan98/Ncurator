import { randomUUID } from 'node:crypto'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import {
  HUMAN_DEFAULT_TOOL_CALL_LIMIT,
  HUMAN_HAND_CALL_LIMIT,
  HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO
} from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import {
  appendDecisionRound,
  buildPreExecutionBlockedExecution,
  buildHandExecution,
} from '../../memory/rounds'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { assertExternalLearnedSkillIds } from '../../skills'
import { getToolSpec } from '../../tools/registry'
import { analyzeReadonlyTerminalCommandPolicy } from '../../tools/terminal/readonlyCommandPolicy'
import {
  createToolCallSchema,
  formatToolCallSchemaDiagnostic,
  readParsedSourcePath
} from '../../toolCallSchema'
import type { HandCallList, HumanRuntimeCache, HumanState, HumanDecisionHint, ToolCallResult } from '../../types'
import { deriveHandFollowupSignals, shouldStopSerialHandPlan } from './followupSignals'
import { executeToolCall } from './toolExecutor'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithDecisionHint } from '../utils/stateTransitions'
import { getAvailableToolNames } from '../utils/runtimeCache'

const DOCX_SERIAL_WRITE_TOOL_NAMES = new Set([
  'docx_create',
  'docx_paragraph_edit',
  'docx_heading_edit',
  'docx_table_edit',
  'docx_text_edit',
  'docx_text_style_edit',
  'docx_delete',
  'docx_rollback'
])

const isDocxSerialWriteCall = (toolName: string): boolean => DOCX_SERIAL_WRITE_TOOL_NAMES.has(toolName)
const isTerminalRunCall = (toolName: string): boolean => toolName === 'terminal_run'

const readTerminalCommandArg = (args: JsonObject): string | undefined =>
  typeof args.command === 'string' && args.command.trim().length > 0 ? args.command.trim() : undefined

type ParsedHandCall = {
  toolName: string
  args: JsonObject
}

const createHandCallLimitDecisionHint = (input: {
  offendingToolNames: string[]
  callCount: number
  limit: number
}): HumanDecisionHint => ({
  code: 'hand_call_limit_exceeded',
  detail: {
    offendingToolNames: input.offendingToolNames,
    callCount: input.callCount,
    limit: input.limit
  }
})

const createDocxSingleFileWriteLimitDecisionHint = (input: {
  offendingToolNames: string[]
  sourcePaths: string[]
}): HumanDecisionHint => ({
  code: 'hand_docx_single_file_write_limit_exceeded',
  detail: {
    offendingToolNames: input.offendingToolNames,
    sourcePaths: input.sourcePaths
  }
})

const buildToolLimitDecisionHint = (toolCallCount: number, limit: number): HumanDecisionHint => ({
  code: 'hand_tool_limit_exceeded',
  detail: {
    toolCallCount,
    limit
  }
})

const buildToolLimitNearExhaustedDecisionHint = (
  toolCallCount: number,
  limit: number
): HumanDecisionHint => ({
  code: 'hand_tool_limit_near_exhausted',
  detail: {
    toolCallCount,
    limit
  }
})

const buildToolLimitDeliveryGuidance = (toolCallCount: number, limit: number): string =>
  `本轮累计工具调用次数已经超过上限，当前为 ${String(toolCallCount)}，上限为 ${String(limit)}。后续没有继续执行更多工具。最终答复中需要明确说明：已经完成了什么、哪些事项尚未继续完成，以及停止原因是工具调用预算耗尽。`

const findSameFileMultiWriteDecisionHint = (
  calls: ParsedHandCall[]
): HumanDecisionHint | undefined => {
  const mutatingCallsBySourcePath = new Map<string, ParsedHandCall[]>()
  calls.forEach((call) => {
    if (!isDocxSerialWriteCall(call.toolName)) return
    const sourcePath = readParsedSourcePath(call.args)
    if (!sourcePath) return
    const existingCalls = mutatingCallsBySourcePath.get(sourcePath) || []
    mutatingCallsBySourcePath.set(sourcePath, [...existingCalls, call])
  })

  const offendingEntries = [...mutatingCallsBySourcePath.entries()].filter(
    ([, calls]) => calls.length > 1
  )
  if (offendingEntries.length === 0) return undefined

  return createDocxSingleFileWriteLimitDecisionHint({
    offendingToolNames: offendingEntries.flatMap(([, calls]) => calls.map((call) => call.toolName)),
    sourcePaths: offendingEntries.map(([sourcePath]) => sourcePath)
  })
}

const validateCalls = (calls: ParsedHandCall[]): HumanDecisionHint | undefined => {
  const sameFileMultiWriteDecisionHint = findSameFileMultiWriteDecisionHint(calls)
  if (sameFileMultiWriteDecisionHint) {
    return sameFileMultiWriteDecisionHint
  }
  if (calls.length > HUMAN_HAND_CALL_LIMIT) {
    return createHandCallLimitDecisionHint({
      offendingToolNames: calls.map((item) => item.toolName),
      callCount: calls.length,
      limit: HUMAN_HAND_CALL_LIMIT
    })
  }
  return undefined
}

const collectApprovalBatchItems = (input: {
  runId: string
  taskId: string
  calls: ParsedHandCall[]
}): Array<{
  itemId: string
  order: number
  toolName: string
  command: string
  reason: string
}> => {
  return input.calls.flatMap((call, index) => {
    if (!isTerminalRunCall(call.toolName)) return []
    const command = readTerminalCommandArg(call.args)
    if (!command) return []
    const readonlyPolicy = analyzeReadonlyTerminalCommandPolicy(command)
    if (readonlyPolicy.executionPolicy === 'readonly_allowed') return []
    return [
      {
        itemId: randomUUID(),
        order: index,
        toolName: call.toolName,
        command,
        reason: readonlyPolicy.reason
      }
    ]
  })
}

const buildApprovalBlockedDecisionHint = (input: {
  decisions: Array<{
    itemId: string
    action: 'approve' | 'reject' | 'guide'
    message?: string
  }>
  approvalItems: Array<{
    itemId: string
    order: number
    toolName: string
    command: string
    reason: string
  }>
}): Extract<HumanDecisionHint, { code: 'terminal_approval_blocked' }> => {
  const allowedCommands = input.decisions
    .filter((decision) => decision.action === 'approve')
    .map((decision) => input.approvalItems.find((item) => item.itemId === decision.itemId)?.command)
    .filter((command): command is string => Boolean(command))
  const blockedCommands = input.approvalItems
    .filter((item) => !input.decisions.some((decision) => decision.itemId === item.itemId && decision.action === 'approve'))
    .map((item) => item.command)
  const guidance = input.decisions
    .filter((decision) => decision.action === 'guide')
    .map((decision) => {
      const matchedItem = input.approvalItems.find((item) => item.itemId === decision.itemId)
      return matchedItem
        ? {
            command: matchedItem.command,
            message: String(decision.message || '').trim()
          }
        : undefined
    })
    .filter((item): item is { command: string; message: string } => Boolean(item))

  return {
    code: 'terminal_approval_blocked',
    detail: {
      allowedCommands,
      blockedCommands,
      guidance
    }
  }
}

const executeHandCalls = async (input: {
  calls: ParsedHandCall[]
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  learnedSkillIds: HumanState['skills']['learnedSkillIds']
}): Promise<ToolCallResult[]> => {
  const results: ToolCallResult[] = []
  for (const toolCall of input.calls) {
    results.push(
      await executeToolCall({
        ctx: input.ctx,
        cache: input.cache,
        taskId: input.taskId,
        learnedSkillIds: input.learnedSkillIds,
        toolName: toolCall.toolName,
        args: toolCall.args
      })
    )

    if (shouldStopSerialHandPlan({ calls: input.calls, results })) {
      break
    }
  }
  return results
}

const buildSchemaInvalidResult = (input: {
  toolName: string
  error: unknown
  callIndex: number
}): ToolCallResult => {
  const diagnostic = formatToolCallSchemaDiagnostic({
    error: input.error,
    pathPrefix: `calls[${String(input.callIndex)}].args`
  })

  return {
    toolName: input.toolName,
    ok: false,
    code: 'invalid_input',
    data: {
      ok: false,
      code: 'invalid_input',
      error: diagnostic.message
    },
    diagnostic: {
      message: diagnostic.message
    }
  }
}

const parseHandCalls = (input: {
  calls: HandCallList
  learnedSkillIds: HumanState['skills']['learnedSkillIds']
}): { ok: true; calls: ParsedHandCall[] } | { ok: false; result: ToolCallResult } => {
  const toolCallSchema = createToolCallSchema(
    getAvailableToolNames({
      learnedSkillIds: input.learnedSkillIds
    })
  )

  const parsedCalls: ParsedHandCall[] = []
  for (const [index, call] of input.calls.entries()) {
    const parsed = toolCallSchema.safeParse(call)
    if (!parsed.success) {
      return {
        ok: false,
        result: buildSchemaInvalidResult({
          toolName: call.toolName,
          error: parsed.error,
          callIndex: index
        })
      }
    }

    parsedCalls.push({
      toolName: parsed.data.toolName,
      args: parsed.data.args as JsonObject
    })
  }

  return {
    ok: true,
    calls: parsedCalls
  }
}

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const toolCallLimit =
      input.ctx.humanRuntimeOverrides?.hardActionLimit || HUMAN_DEFAULT_TOOL_CALL_LIMIT

    if (!state.execution.currentThought || state.execution.currentThought.nextAction.action !== 'hand') {
      return returnToBrain(state)
    }

    const { calls } = state.execution.currentThought.nextAction
    const parsedCallsResult = parseHandCalls({
      calls,
      learnedSkillIds: state.skills.learnedSkillIds
    })
    if (!parsedCallsResult.ok) {
      const results = [parsedCallsResult.result]
      return returnToBrainAfterTrace({
        ctx: input.ctx,
        cache: input.cache,
        state,
        source: 'hand',
        traceItems: results.map((result) => ({
          action: 'call_tool',
          publicNarrative: buildToolCallDisplayText(result),
          resultStatus: 'error',
          toolName: result.toolName,
          summary: buildToolCallDisplayText(result)
        })),
        stage: 'human_hand',
        overrides: {
          execution: {
            lastToolResults: results
          },
          memory: {
            ...state.memory,
            taskRun: appendDecisionRound({
              state,
              execution: buildHandExecution({
                calls,
                toolResults: results
              })
            })
          }
        }
      })
    }

    const parsedCalls = parsedCallsResult.calls
    const approvalItems = collectApprovalBatchItems({
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      calls: parsedCalls
    })
    const invalidPlanDecisionHint = validateCalls(parsedCalls)
    if (invalidPlanDecisionHint) {
      return returnToBrainWithDecisionHint({
        ctx: input.ctx,
        state,
        source: 'hand',
        decisionHint: invalidPlanDecisionHint,
        overrides: {
          memory: {
            ...state.memory,
            taskRun: appendDecisionRound({
              state,
              execution: buildHandExecution({
                calls,
                toolResults: [],
                decisionHint: invalidPlanDecisionHint
              })
            })
          }
        }
      })
    }

    if (approvalItems.length > 0) {
      const batchId = randomUUID()
      const approvalBatchResult = await input.ctx.requestApprovalBatch({
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        batchId,
        items: approvalItems,
        stage: 'human_hand'
      })
      if (!approvalBatchResult.accepted) {
        throw new Error(approvalBatchResult.error)
      }

      const allApproved = approvalBatchResult.decisions.every(
        (decision) => decision.action === 'approve'
      )
      if (!allApproved) {
        const decisionHint = buildApprovalBlockedDecisionHint({
          decisions: approvalBatchResult.decisions,
          approvalItems
        })
        return returnToBrainWithDecisionHint({
          ctx: input.ctx,
          state,
          source: 'hand',
          decisionHint,
          overrides: {
            memory: {
              ...state.memory,
              taskRun: appendDecisionRound({
                state,
                execution: buildPreExecutionBlockedExecution(decisionHint)
              })
            }
          }
        })
      }
    }

    const learnedSkillIds = state.skills.learnedSkillIds
    const results = await executeHandCalls({
      calls: parsedCalls,
      ctx: input.ctx,
      cache: input.cache,
      taskId: state.task.taskId,
      learnedSkillIds
    })
    input.cache.toolCallCount += results.length

    const followupSignals = deriveHandFollowupSignals({
      calls,
      results
    })
    const handDeliveryGuidance = createDeliveryGuidanceItem(
      'hand',
      followupSignals.deliveryGuidance
    )
    const toolLimitDecisionHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitDecisionHint(input.cache.toolCallCount, toolCallLimit)
        : input.cache.toolCallCount >= Math.ceil(toolCallLimit * HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO)
          ? buildToolLimitNearExhaustedDecisionHint(input.cache.toolCallCount, toolCallLimit)
          : undefined
    const decisionHint = toolLimitDecisionHint || followupSignals.decisionHint
    const toolLimitDeliveryGuidance = createDeliveryGuidanceItem(
      'hand',
      toolLimitDecisionHint?.code === 'hand_tool_limit_exceeded'
        ? buildToolLimitDeliveryGuidance(input.cache.toolCallCount, toolCallLimit)
        : undefined
    )
    const artifacts = mergeArtifactRefs(
      state.execution.artifacts,
      extractArtifactRefsFromToolResults(results)
    )
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      source: 'hand',
      traceItems: results.map((result) => ({
        action: 'call_tool',
        publicNarrative: buildToolCallDisplayText(result),
        resultStatus: result.code === 'ok' ? 'ok' : 'error',
        toolName: result.toolName,
        summary: buildToolCallDisplayText(result)
      })),
      stage: 'human_hand',
      decisionHint,
      overrides: {
        execution: {
          lastToolResults: results,
          artifacts,
          deliveryGuidanceItems: mergeDeliveryGuidanceItems(
            mergeDeliveryGuidanceItems(
              state.execution.deliveryGuidanceItems,
              handDeliveryGuidance
            ),
            toolLimitDeliveryGuidance
          )
        },
        memory: {
          ...state.memory,
          taskRun: appendDecisionRound({
            state,
            execution: buildHandExecution({
              calls,
              toolResults: results,
              decisionHint
            })
          })
        }
      }
    })
    return nextState
  }
}
