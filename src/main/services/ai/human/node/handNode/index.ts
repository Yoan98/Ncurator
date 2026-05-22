import { randomUUID } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
import {
  HUMAN_DEFAULT_TOOL_CALL_LIMIT,
  HUMAN_MAX_PARALLEL_TOOL_CALLS,
  HUMAN_TOOL_USE_PLAN_LIMIT
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
import type { ToolExecutionMeta } from '../../tools/types'
import type { HumanRuntimeCache, HumanState, HumanDecisionHint, ToolCallResult, ToolUsePlan } from '../../types'
import { deriveHandFollowupSignals, shouldStopSerialHandPlan } from './followupSignals'
import { executeToolCall } from './toolExecutor'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithDecisionHint } from '../utils/stateTransitions'

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

const readSourcePathArg = (args: JsonObject): string | undefined =>
  typeof args.sourcePath === 'string' && args.sourcePath.trim().length > 0 ? args.sourcePath : undefined

const readTerminalCommandArg = (args: JsonObject): string | undefined =>
  typeof args.command === 'string' && args.command.trim().length > 0 ? args.command.trim() : undefined

export const getToolExecutionMeta = (input: {
  toolName: string
  args: JsonObject
}): ToolExecutionMeta => {
  const spec = getToolSpec(input.toolName)
  if (spec) return spec.resolveExecutionMeta(input.args)

  return {
    mutability: 'mutating',
    parallelSafe: false
  }
}

export const canBatchPlan = (input: {
  actions: Array<{ toolName: string; args: JsonObject }>
  maxParallel: number
}): boolean => {
  if (input.actions.length <= 1) return true
  if (input.actions.length > input.maxParallel) return false

  for (const action of input.actions) {
    const meta = getToolExecutionMeta(action)
    if (meta.mutability !== 'read_only' || !meta.parallelSafe) return false
  }
  return true
}

const createHandPlanInvalidDecisionHint = (input: {
  mode: ToolUsePlan['mode']
  reason: Extract<HumanDecisionHint, { code: 'hand_plan_invalid' }>['detail']['reason']
  offendingToolNames: string[]
  sourcePaths?: string[]
  callCount?: number
  limit?: number
}): HumanDecisionHint => ({
  code: 'hand_plan_invalid',
  detail: {
    mode: input.mode,
    reason: input.reason,
    offendingToolNames: input.offendingToolNames,
    sourcePaths: input.sourcePaths,
    callCount: input.callCount,
    limit: input.limit
  }
})

const buildToolLimitDecisionHint = (toolCallCount: number, limit: number): HumanDecisionHint => ({
  code: 'hand_tool_limit_exceeded',
  detail: {
    toolCallCount,
    limit
  }
})

const findSameFileMultiWriteDecisionHint = (
  toolUsePlan: ToolUsePlan
): HumanDecisionHint | undefined => {
  if (toolUsePlan.mode !== 'serial') return undefined

  const mutatingCallsBySourcePath = new Map<string, ToolUsePlan['calls']>()
  toolUsePlan.calls.forEach((call) => {
    if (!isDocxSerialWriteCall(call.toolName)) return
    const sourcePath = readSourcePathArg(call.args)
    if (!sourcePath) return
    const existingCalls = mutatingCallsBySourcePath.get(sourcePath) || []
    mutatingCallsBySourcePath.set(sourcePath, [...existingCalls, call])
  })

  const offendingEntries = [...mutatingCallsBySourcePath.entries()].filter(
    ([, calls]) => calls.length > 1
  )
  if (offendingEntries.length === 0) return undefined

  return createHandPlanInvalidDecisionHint({
    mode: 'serial',
    reason: 'docx_single_file_write_limit_exceeded',
    offendingToolNames: offendingEntries.flatMap(([, calls]) => calls.map((call) => call.toolName)),
    sourcePaths: offendingEntries.map(([sourcePath]) => sourcePath),
    callCount: offendingEntries.reduce((total, [, calls]) => total + calls.length, 0),
    limit: 1
  })
}

const validateToolUsePlan = (toolUsePlan: ToolUsePlan): HumanDecisionHint | undefined => {
  if (toolUsePlan.mode === 'serial') {
    const sameFileMultiWriteDecisionHint = findSameFileMultiWriteDecisionHint(toolUsePlan)
    if (sameFileMultiWriteDecisionHint) {
      return sameFileMultiWriteDecisionHint
    }
  }
  if (toolUsePlan.calls.length > HUMAN_TOOL_USE_PLAN_LIMIT) {
    return createHandPlanInvalidDecisionHint({
      mode: toolUsePlan.mode,
      reason: 'tool_use_plan_limit_exceeded',
      offendingToolNames: toolUsePlan.calls.map((item) => item.toolName),
      callCount: toolUsePlan.calls.length,
      limit: HUMAN_TOOL_USE_PLAN_LIMIT
    })
  }
  if (toolUsePlan.mode === 'serial') {
    return undefined
  }
  if (toolUsePlan.calls.length > HUMAN_MAX_PARALLEL_TOOL_CALLS) {
    return createHandPlanInvalidDecisionHint({
      mode: 'parallel',
      reason: 'parallel_limit_exceeded',
      offendingToolNames: toolUsePlan.calls.map((item) => item.toolName),
      callCount: toolUsePlan.calls.length,
      limit: HUMAN_MAX_PARALLEL_TOOL_CALLS
    })
  }

  const offendingToolNames = toolUsePlan.calls
    .filter((item) => {
      const meta = getToolExecutionMeta({
        toolName: item.toolName,
        args: item.args
      })
      return meta.mutability !== 'read_only' || !meta.parallelSafe
    })
    .map((item) => item.toolName)

  return offendingToolNames.length > 0
    ? createHandPlanInvalidDecisionHint({
        mode: 'parallel',
        reason: 'parallel_requires_read_only',
        offendingToolNames
      })
    : undefined
}

const collectApprovalBatchItems = (input: {
  runId: string
  taskId: string
  toolUsePlan: ToolUsePlan
}): Array<{
  itemId: string
  order: number
  toolName: string
  command: string
  reason: string
}> => {
  if (input.toolUsePlan.mode !== 'serial') return []

  return input.toolUsePlan.calls.flatMap((call, index) => {
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
  batchId: string
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
}): Extract<HumanDecisionHint, { code: 'hand_approval_blocked' }> => {
  const approvedItemIds = input.decisions
    .filter((decision) => decision.action === 'approve')
    .map((decision) => decision.itemId)
  const rejectedItemIds = input.decisions
    .filter((decision) => decision.action === 'reject')
    .map((decision) => decision.itemId)
  const guidedItems = input.decisions
    .filter((decision) => decision.action === 'guide')
    .map((decision) => {
      const matchedItem = input.approvalItems.find((item) => item.itemId === decision.itemId)
      return matchedItem
        ? {
            itemId: matchedItem.itemId,
            command: matchedItem.command,
            message: String(decision.message || '').trim()
          }
        : undefined
    })
    .filter((item): item is { itemId: string; command: string; message: string } => Boolean(item))

  return {
    code: 'hand_approval_blocked',
    detail: {
      reason: rejectedItemIds.length > 0 ? 'user_rejected' : 'user_guided',
      batchId: input.batchId,
      blockedToolNames: input.approvalItems.map((item) => item.toolName),
      blockedCommands: input.approvalItems.map((item) => item.command),
      approvedItemIds,
      rejectedItemIds,
      guidedItems
    }
  }
}

const executeToolUsePlan = async (input: {
  toolUsePlan: ToolUsePlan
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  learnedSkillIds: HumanState['skills']['learnedSkillIds']
}): Promise<ToolCallResult[]> => {
  if (input.toolUsePlan.mode === 'parallel') {
    return Promise.all(
      input.toolUsePlan.calls.map((toolCall) =>
        executeToolCall({
          ctx: input.ctx,
          cache: input.cache,
          taskId: input.taskId,
          learnedSkillIds: input.learnedSkillIds,
          toolName: toolCall.toolName,
          args: toolCall.args
        })
      )
    )
  }
  const results: ToolCallResult[] = []
  for (const toolCall of input.toolUsePlan.calls) {
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

    if (
      input.toolUsePlan.mode === 'serial' &&
      shouldStopSerialHandPlan({
        toolUsePlan: input.toolUsePlan,
        results
      })
    ) {
      break
    }
  }
  return results
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

    const { toolUsePlan } = state.execution.currentThought.nextAction
    const approvalItems = collectApprovalBatchItems({
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      toolUsePlan
    })
    const invalidPlanDecisionHint = validateToolUsePlan(toolUsePlan)
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
                toolUsePlan,
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
          batchId,
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
    const results = await executeToolUsePlan({
      toolUsePlan,
      ctx: input.ctx,
      cache: input.cache,
      taskId: state.task.taskId,
      learnedSkillIds
    })
    input.cache.toolCallCount += results.length

    const followupSignals = deriveHandFollowupSignals({
      toolUsePlan,
      results
    })
    const handDeliveryGuidance = createDeliveryGuidanceItem(
      'hand',
      followupSignals.deliveryGuidance
    )
    const toolLimitDecisionHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitDecisionHint(input.cache.toolCallCount, toolCallLimit)
        : undefined
    const decisionHint = followupSignals.decisionHint || toolLimitDecisionHint
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
            state.execution.deliveryGuidanceItems,
            handDeliveryGuidance
          )
        },
        memory: {
          ...state.memory,
          taskRun: appendDecisionRound({
            state,
            execution: buildHandExecution({
              toolUsePlan,
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
