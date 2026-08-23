import { randomUUID } from 'node:crypto'
import { ToolMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, JsonObject, JsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import { buildHistoryToolResult } from '../../memory/historyToolResult'
import { buildToolHistoryReturnValue, buildToolResultMessageContent } from '../../shared/historyRenderers'
import { buildToolFeedback } from '../../shared/toolFeedback'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { assertExternalLearnedSkillIds } from '../../skills'
import { analyzeTerminalCommandPolicy } from '../../tools/terminal/commandPolicy'
import type {
  HumanRuntimeCache,
  HumanState,
  ToolCallResult
} from '../../types'
import { executeToolCall } from './toolExecutor'
import { returnToBrain, returnToBrainAfterTrace } from '../utils/stateTransitions'
import { advanceDispatchState } from '../dispatch'

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
  toolCallId: string
  toolName: string
  args: JsonObject
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
  }
  return results
}

const appendToolMessages = (input: {
  cache: HumanRuntimeCache
  calls: ParsedHandCall[]
  results: ToolCallResult[]
}): Array<{ toolCallId: string; toolName: string; ok: boolean; result: JsonValue | undefined }> => {
  const messages = input.cache.messages || []
  const transcriptEntries: Array<{
    toolCallId: string
    toolName: string
    ok: boolean
    result: JsonValue | undefined
  }> = []
  input.calls.forEach((call, index) => {
    const result = input.results[index]
    if (!result) return
    const historyResult = buildHistoryToolResult(result)
    const returnValue = buildToolHistoryReturnValue(historyResult)
    messages.push(
      new ToolMessage({
        content: buildToolResultMessageContent(historyResult),
        tool_call_id: call.toolCallId
      })
    )
    transcriptEntries.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: result.ok,
      result: returnValue
    })
  })
  input.cache.messages = messages
  return transcriptEntries
}

const buildApprovalBlockedToolMessage = (input: {
  decision: { action: 'approve' | 'reject' | 'guide'; message?: string }
  command: string
}): string => {
  if (input.decision.action === 'reject') {
    return `该命令未获用户批准，本轮没有执行：${input.command}。`
  }
  if (input.decision.action === 'guide') {
    return `用户对命令「${input.command}」补充了说明，本轮没有执行：${String(
      input.decision.message || ''
    ).trim()}`
  }
  return `该命令已获批准，但因为本轮存在未获批准的命令，所以整体没有执行，请调整方案后重试：${input.command}。`
}

const appendBlockedApprovalToolMessages = (input: {
  cache: HumanRuntimeCache
  calls: ParsedHandCall[]
  decisions: Array<{ itemId: string; action: 'approve' | 'reject' | 'guide'; message?: string }>
  approvalItems: Array<{ itemId: string; order: number; toolName: string; command: string }>
}): ChatMessageLogEntry[] => {
  const messages = input.cache.messages || []
  const decisionByItemId = new Map(input.decisions.map((decision) => [decision.itemId, decision]))
  const transcriptEntries: ChatMessageLogEntry[] = []

  input.approvalItems.forEach((item) => {
    const decision = decisionByItemId.get(item.itemId)
    const call = input.calls[item.order]
    if (!decision || !call) return
    const message = buildApprovalBlockedToolMessage({ decision, command: item.command })
    const feedback = buildToolFeedback({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: false,
      errorCode: 'approval_blocked',
      errorMessage: message
    })
    messages.push(feedback.message)
    transcriptEntries.push(feedback.transcript)
  })

  input.cache.messages = messages
  return transcriptEntries
}

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'hand') {
      return advanceDispatchState(state)
    }

    const rawCalls = pendingRound.nextAction.calls
    const calls: ParsedHandCall[] = Array.isArray(rawCalls)
      ? rawCalls.flatMap((call) => {
          if (!call || typeof call !== 'object' || Array.isArray(call)) return []
          const candidate = call as Record<string, unknown>
          if (typeof candidate.toolCallId !== 'string' || !candidate.toolCallId.trim()) return []
          if (typeof candidate.toolName !== 'string' || !candidate.toolName.trim()) return []
          if (
            !candidate.args ||
            typeof candidate.args !== 'object' ||
            Array.isArray(candidate.args)
          )
            return []
          return [
            {
              toolCallId: candidate.toolCallId,
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
        const blockedTranscriptEntries = appendBlockedApprovalToolMessages({
          cache: input.cache,
          calls,
          decisions: approvalBatchResult.decisions,
          approvalItems
        })
        await input.ctx.appendMessageLog(blockedTranscriptEntries)
        return returnToBrain(state, {
          execution: {
            stage: 'context_budget',
            pendingDispatch: undefined
          },
          memory: {
            ...state.memory
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

    const toolTranscript = appendToolMessages({
      cache: input.cache,
      calls,
      results
    })
    await input.ctx.appendMessageLog(
      toolTranscript.map((entry) => ({
        kind: 'tool' as const,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        ok: entry.ok,
        result: entry.result
      }))
    )

    const artifacts = mergeArtifactRefs(
      state.execution.artifacts,
      extractArtifactRefsFromToolResults(results)
    )
    return returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      traceItems: results.map((result) => ({
        action: 'call_tool',
        publicNarrative: buildToolCallDisplayText(result),
        resultStatus: result.ok ? 'ok' : 'error',
        toolName: result.toolName,
        summary: buildToolCallDisplayText(result)
      })),
      stage: 'human_hand',
      overrides: {
        execution: {
          lastToolResults: results,
          artifacts
        },
        memory: {
          ...state.memory
        }
      }
    })
  }
}
