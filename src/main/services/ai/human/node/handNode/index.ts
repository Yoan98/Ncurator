import { randomUUID } from 'node:crypto'
import { ToolMessage } from '@langchain/core/messages'
import type { JsonObject } from '../../../../../../shared/types'
import {
  HUMAN_DEFAULT_TOOL_CALL_LIMIT,
  HUMAN_HAND_CALL_LIMIT,
  HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO
} from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import { buildHistoryToolResult } from '../../memory/historyToolResult'
import { buildToolResultMessageContent } from '../../shared/historyRenderers'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { assertExternalLearnedSkillIds } from '../../skills'
import { analyzeTerminalCommandPolicy } from '../../tools/terminal/commandPolicy'
import type {
  HumanRuntimeCache,
  HumanState,
  HumanDecisionHint,
  ToolCallResult
} from '../../types'
import { renderDeliveryGuidanceForMouth } from '../../prompts/deliveryGuidance'
import { deriveHandFollowupSignals, shouldStopSerialHandPlan } from './followupSignals'
import { executeToolCall } from './toolExecutor'
import {
  returnToBrainAfterTrace,
  returnToBrainWithDecisionHint
} from '../utils/stateTransitions'
import { advanceDispatchState } from '../dispatch'

export const resolveHumanToolCallLimit = (override?: number): number =>
  override ?? HUMAN_DEFAULT_TOOL_CALL_LIMIT

export const resolveHumanToolLimitWarningRatio = (override?: number): number =>
  override ?? HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO

const isTerminalRunCall = (toolName: string): boolean => toolName === 'terminal_run'
const isBrowserUseCall = (toolName: string): boolean => toolName === 'browser_use'

const readTerminalCommandArg = (args: JsonObject): string | undefined =>
  typeof args.command === 'string' && args.command.trim().length > 0
    ? args.command.trim()
    : undefined

const readCommandExplanationArg = (args: JsonObject): string | undefined =>
  typeof args.commandExplanation === 'string' && args.commandExplanation.trim().length > 0
    ? args.commandExplanation.trim()
    : undefined

const readBrowserUseApprovalText = (args: JsonObject): string => {
  const action = typeof args.action === 'string' && args.action.trim() ? args.action.trim() : ''
  const instruction =
    typeof args.instruction === 'string' && args.instruction.trim()
      ? args.instruction.trim()
      : '使用内置浏览器'
  const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : ''
  if (action === 'navigate') return `打开网页：${url || instruction}`
  if (action === 'observe') return `观察页面：${instruction}`
  if (action === 'extract') return `提取页面内容：${instruction}`
  if (action === 'act') return `操作页面：${instruction}`
  return `操作浏览器：${instruction}`
}

type ParsedHandCall = {
  toolCallId?: string
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

const validateCalls = (calls: ParsedHandCall[]): HumanDecisionHint | undefined => {
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
  platform: AiRunContext['platform']
  cache: HumanRuntimeCache
}): Array<{
  itemId: string
  order: number
  toolName: string
  command: string
  commandExplanation: string
  reason: string
}> => {
  return input.calls.flatMap((call, index) => {
    if (isBrowserUseCall(call.toolName)) {
      if (input.cache.approvedBrowserUseTaskIds?.has(input.taskId)) return []
      return [
        {
          itemId: randomUUID(),
          order: index,
          toolName: call.toolName,
          command: readBrowserUseApprovalText(call.args),
          commandExplanation: '使用内置浏览器执行网页操作。',
          reason: '首次使用内置浏览器网页操作能力'
        }
      ]
    }

    if (isTerminalRunCall(call.toolName)) {
      const command = readTerminalCommandArg(call.args)
      if (!command) return []
      const riskPolicy = analyzeTerminalCommandPolicy(command, input.platform)
      if (riskPolicy.executionPolicy === 'auto_allow') return []
      return [
        {
          itemId: randomUUID(),
          order: index,
          toolName: call.toolName,
          command,
          commandExplanation: readCommandExplanationArg(call.args) || '执行这条终端指令。',
          reason: riskPolicy.reason
        }
      ]
    }

    return []
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
    .filter(
      (item) =>
        !input.decisions.some(
          (decision) => decision.itemId === item.itemId && decision.action === 'approve'
        )
    )
    .map((item) => item.command)
  const notes = input.decisions
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
      notes
    }
  }
}

const buildApprovedTerminalCommandKey = (command: string): string => String(command || '').trim()

const markApprovedTerminalCommands = (input: {
  cache: HumanRuntimeCache
  decisions: Array<{
    itemId: string
    action: 'approve' | 'reject' | 'guide'
  }>
  approvalItems: Array<{
    itemId: string
    command: string
  }>
}): void => {
  const approvedCommands = input.decisions
    .filter((decision) => decision.action === 'approve')
    .map((decision) => input.approvalItems.find((item) => item.itemId === decision.itemId)?.command)
    .filter((command): command is string => Boolean(command))

  if (approvedCommands.length === 0) return
  const approvedCounts = input.cache.approvedTerminalCommandCounts || new Map<string, number>()
  approvedCommands.forEach((command) => {
    const key = buildApprovedTerminalCommandKey(command)
    approvedCounts.set(key, (approvedCounts.get(key) || 0) + 1)
  })
  input.cache.approvedTerminalCommandCounts = approvedCounts
}

const markApprovedBrowserUseTask = (input: {
  cache: HumanRuntimeCache
  taskId: string
  decisions: Array<{
    itemId: string
    action: 'approve' | 'reject' | 'guide'
  }>
  approvalItems: Array<{
    itemId: string
    toolName: string
  }>
}): void => {
  const approved = input.decisions.some((decision) => {
    if (decision.action !== 'approve') return false
    const item = input.approvalItems.find((approvalItem) => approvalItem.itemId === decision.itemId)
    return item?.toolName === 'browser_use'
  })
  if (!approved) return
  const approvedTaskIds = input.cache.approvedBrowserUseTaskIds || new Set<string>()
  approvedTaskIds.add(input.taskId)
  input.cache.approvedBrowserUseTaskIds = approvedTaskIds
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

const appendToolMessages = (input: {
  cache: HumanRuntimeCache
  calls: ParsedHandCall[]
  results: ToolCallResult[]
}): void => {
  const messages = input.cache.messages || []
  input.calls.forEach((call, index) => {
    const result = input.results[index]
    if (!result) return
    const historyResult = buildHistoryToolResult(result)
    messages.push(
      new ToolMessage({
        content: buildToolResultMessageContent(historyResult),
        tool_call_id: call.toolCallId || `call-${index}`
      })
    )
  })
  input.cache.messages = messages
}

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const toolCallLimit = resolveHumanToolCallLimit(
      input.ctx.humanRuntimeOverrides?.hardActionLimit
    )
    const toolLimitWarningRatio = resolveHumanToolLimitWarningRatio(
      input.ctx.humanRuntimeOverrides?.toolLimitWarningRatio
    )

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'hand') {
      return advanceDispatchState(state)
    }

    const rawCalls = pendingRound.nextAction.calls
    const calls: ParsedHandCall[] = Array.isArray(rawCalls)
      ? rawCalls.flatMap((call) => {
          if (!call || typeof call !== 'object' || Array.isArray(call)) return []
          const candidate = call as Record<string, unknown>
          if (typeof candidate.toolName !== 'string' || !candidate.toolName.trim()) return []
          if (
            !candidate.args ||
            typeof candidate.args !== 'object' ||
            Array.isArray(candidate.args)
          )
            return []
          return [
            {
              toolCallId:
                typeof candidate.toolCallId === 'string' ? candidate.toolCallId : undefined,
              toolName: candidate.toolName,
              args: candidate.args as JsonObject
            }
          ]
        })
      : []

    if (calls.length === 0) {
      return advanceDispatchState(state)
    }

    const approvalItems = collectApprovalBatchItems({
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      calls,
      platform: input.ctx.platform,
      cache: input.cache
    })
    const invalidPlanDecisionHint = validateCalls(calls)
    if (invalidPlanDecisionHint) {
      return returnToBrainWithDecisionHint({
        ctx: input.ctx,
        state,
        source: 'hand',
        decisionHint: invalidPlanDecisionHint,
        overrides: {
          memory: {
            ...state.memory
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
        input.ctx.checkCancelled()
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
              ...state.memory
            }
          }
        })
      }
      markApprovedTerminalCommands({
        cache: input.cache,
        decisions: approvalBatchResult.decisions,
        approvalItems
      })
      markApprovedBrowserUseTask({
        cache: input.cache,
        taskId: state.task.taskId,
        decisions: approvalBatchResult.decisions,
        approvalItems
      })
    }

    const results = await executeHandCalls({
      calls,
      ctx: input.ctx,
      cache: input.cache,
      taskId: state.task.taskId,
      learnedSkillIds: state.skills.learnedSkillIds
    })
    input.cache.toolCallCount += results.length

    appendToolMessages({
      cache: input.cache,
      calls,
      results
    })
    await input.ctx.appendTranscript(
      calls.map((call, index) => ({
        kind: 'tool' as const,
        toolCallId: call.toolCallId || `call-${index}`,
        toolName: call.toolName,
        result: results[index]?.data
      }))
    )

    const followupSignals = deriveHandFollowupSignals({
      calls,
      results
    })
    const toolLimitDecisionHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitDecisionHint(input.cache.toolCallCount, toolCallLimit)
        : input.cache.toolCallCount >= Math.ceil(toolCallLimit * toolLimitWarningRatio)
          ? buildToolLimitNearExhaustedDecisionHint(input.cache.toolCallCount, toolCallLimit)
          : undefined
    const decisionHint = toolLimitDecisionHint || followupSignals.decisionHint
    const handDeliveryGuidance = createDeliveryGuidanceItem(
      'hand',
      renderDeliveryGuidanceForMouth(decisionHint)
    )
    const artifacts = mergeArtifactRefs(
      state.execution.artifacts,
      extractArtifactRefsFromToolResults(results)
    )
    return returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      source: 'hand',
      traceItems: results.map((result) => ({
        action: 'call_tool',
        publicNarrative: buildToolCallDisplayText(result),
        resultStatus: result.ok ? 'ok' : 'error',
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
          ...state.memory
        }
      }
    })
  }
}
