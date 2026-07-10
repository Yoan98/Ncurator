import { randomUUID } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
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
  buildHandExecution
} from '../../memory/rounds'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { assertExternalLearnedSkillIds } from '../../skills'
import { analyzeSafeTerminalCommandPolicy } from '../../tools/terminal/commandPolicy'
import { createToolCallSchema, formatToolCallSchemaDiagnostic } from '../../toolCallSchema'
import type {
  HandCallList,
  HumanRuntimeCache,
  HumanState,
  HumanDecisionHint,
  ToolCallResult
} from '../../types'
import { renderDeliveryGuidanceForMouth } from '../../prompts/deliveryGuidance'
import { deriveHandFollowupSignals, shouldStopSerialHandPlan } from './followupSignals'
import { buildHandCallInvalidHint } from './decisionHints'
import { executeToolCall } from './toolExecutor'
import {
  returnToBrain,
  returnToBrainAfterTrace,
  returnToBrainWithDecisionHint
} from '../utils/stateTransitions'
import { getAvailableToolNames } from '../utils/runtimeCache'

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
      const safePolicy = analyzeSafeTerminalCommandPolicy(command, input.platform)
      if (safePolicy.executionPolicy === 'safe_allowed') return []
      return [
        {
          itemId: randomUUID(),
          order: index,
          toolName: call.toolName,
          command,
          commandExplanation: readCommandExplanationArg(call.args) || '执行这条终端指令。',
          reason: safePolicy.reason
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
    data: {
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
  allowedToolNames?: readonly string[]
}): { ok: true; calls: ParsedHandCall[] } | { ok: false; results: ToolCallResult[] } => {
  const toolCallSchema = createToolCallSchema(
    getAvailableToolNames({
      learnedSkillIds: input.learnedSkillIds,
      allowedToolNames: input.allowedToolNames
    })
  )

  const parsedCalls: ParsedHandCall[] = []
  const invalidResults: ToolCallResult[] = []
  for (const [index, call] of input.calls.entries()) {
    const parsed = toolCallSchema.safeParse(call)
    if (!parsed.success) {
      invalidResults.push(
        buildSchemaInvalidResult({
          toolName: call.toolName,
          error: parsed.error,
          callIndex: index
        })
      )
      continue
    }

    const data = parsed.data as { toolName: string; args: JsonObject }
    parsedCalls.push({
      toolName: data.toolName,
      args: data.args
    })
  }

  if (invalidResults.length > 0) {
    return {
      ok: false,
      results: invalidResults
    }
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

    if (
      !state.execution.currentThought ||
      state.execution.currentThought.nextAction.action !== 'hand'
    ) {
      return returnToBrain(state)
    }

    const { calls } = state.execution.currentThought.nextAction
    const parsedCallsResult = parseHandCalls({
      calls,
      learnedSkillIds: state.skills.learnedSkillIds,
      allowedToolNames: input.ctx.allowedToolNames
    })
    if (!parsedCallsResult.ok) {
      const results = parsedCallsResult.results
      const decisionHint = buildHandCallInvalidHint(
        results.map((result) => ({
          callIndex: Number(
            String(result.diagnostic?.message || '').match(
              /^tool call schema invalid\ncalls\[(\d+)\]\.args:/
            )?.[1] || 0
          ),
          toolName: result.toolName,
          message: String(
            result.diagnostic?.message ||
              (result.data && typeof result.data === 'object' && !Array.isArray(result.data)
                ? result.data.error
                : '') ||
              ''
          ).trim()
        }))
      )
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
        decisionHint,
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
                toolResults: results,
                decisionHint
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
      calls: parsedCalls,
      platform: input.ctx.platform,
      cache: input.cache
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
    const toolLimitDecisionHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitDecisionHint(input.cache.toolCallCount, toolCallLimit)
        : input.cache.toolCallCount >=
            Math.ceil(toolCallLimit * HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO)
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
    const nextState = returnToBrainAfterTrace({
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
