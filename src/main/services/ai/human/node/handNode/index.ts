import { randomUUID } from 'node:crypto'
import { ToolMessage } from '@langchain/core/messages'
import type {
  ChatMessageImageRef,
  ChatMessageLogEntry,
  JsonObject
} from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import {
  emitToolProcessCompleted,
  emitToolProcessStarted
} from '../../../events/processEvents'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import { buildModelToolResultDelivery } from '../../shared/modelToolResult'
import { buildToolFeedback } from '../../shared/toolFeedback'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { assertExternalLearnedSkillIds } from '../../skills'
import { analyzeTerminalCommandPolicy } from '../../tools/terminal/commandPolicy'
import type { HumanRuntimeCache, HumanState, ToolCallResult } from '../../types'
import { executeToolCall } from './toolExecutor'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'
import { createImageReferenceMessage } from '../../memory/multimodal'

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
          itemId: call.toolCallId,
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
          itemId: call.toolCallId,
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

const appendToolMessages = async (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  calls: ParsedHandCall[]
  results: ToolCallResult[]
}): Promise<
  Array<{
    toolCallId: string
    toolName: string
    ok: boolean
    content: string
    images?: ChatMessageImageRef[]
  }>
> => {
  const messages = input.cache.messages || []
  const transcriptEntries: Array<{
    toolCallId: string
    toolName: string
    ok: boolean
    content: string
    images?: ChatMessageImageRef[]
  }> = []
  const imageRefs: ChatMessageImageRef[] = []
  for (let index = 0; index < input.calls.length; index += 1) {
    const call = input.calls[index]
    const result = input.results[index]
    if (!result) continue
    const delivery = await buildModelToolResultDelivery({
      ctx: input.ctx,
      toolCallId: call.toolCallId,
      args: call.args,
      result
    })
    messages.push(
      new ToolMessage({
        content: delivery.content,
        tool_call_id: call.toolCallId
      })
    )
    if (result.ok && result.imageRefs?.length) {
      imageRefs.push(...result.imageRefs)
    }
    transcriptEntries.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: delivery.ok,
      content: delivery.content,
      images: result.ok ? result.imageRefs : undefined
    })
  }
  if (imageRefs.length > 0) messages.push(createImageReferenceMessage(imageRefs))
  input.cache.messages = messages
  return transcriptEntries
}

const buildApprovalBlockedToolMessage = (input: {
  decision: { action: 'approve' | 'reject' | 'guide'; message?: string }
  command: string
}): string => {
  if (input.decision.action === 'reject') {
    return `The user did not approve this operation, so it was not executed: ${input.command}`
  }
  if (input.decision.action === 'guide') {
    return `The user provided additional guidance, so this operation was not executed: ${input.command}. Guidance: ${String(
      input.decision.message || ''
    ).trim()}`
  }
  return `This operation was approved but was not executed because another operation in the same batch was not approved: ${input.command}`
}

const buildApprovalBatchResolvedAnnotation = (input: {
  batchId: string
  decisions: Array<{ itemId: string; action: 'approve' | 'reject' | 'guide'; message?: string }>
  approvalItems: Array<{
    itemId: string
    toolName: string
    command: string
  }>
}): ChatMessageLogEntry => {
  const decisionByItemId = new Map(input.decisions.map((decision) => [decision.itemId, decision]))
  return {
    kind: 'annotation',
    eventType: 'approval_batch_resolved',
    payload: {
      batchId: input.batchId,
      items: input.approvalItems.map((item) => {
        const decision = decisionByItemId.get(item.itemId)
        return {
          toolCallId: item.itemId,
          toolName: item.toolName,
          command: item.command,
          action: decision?.action || 'reject',
          message:
            typeof decision?.message === 'string' && decision.message.trim()
              ? decision.message.trim()
              : undefined
        }
      })
    }
  }
}

const appendBlockedApprovalToolMessages = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  calls: ParsedHandCall[]
  decisions: Array<{ itemId: string; action: 'approve' | 'reject' | 'guide'; message?: string }>
  approvalItems: Array<{ itemId: string; order: number; toolName: string; command: string }>
}): ChatMessageLogEntry[] => {
  const messages = input.cache.messages || []
  const decisionByItemId = new Map(input.decisions.map((decision) => [decision.itemId, decision]))
  const transcriptEntries: ChatMessageLogEntry[] = []

  const approvalItemByOrder = new Map(input.approvalItems.map((item) => [item.order, item]))

  input.calls.forEach((call, order) => {
    const item = approvalItemByOrder.get(order)
    const decision = item ? decisionByItemId.get(item.itemId) : undefined
    const message =
      item && decision
        ? buildApprovalBlockedToolMessage({ decision, command: item.command })
        : 'This tool call was not executed because the batch contained an unapproved operation.'
    emitToolProcessStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: call.args
    })
    emitToolProcessCompleted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: false,
      error: message
    })
    const feedback = buildToolFeedback({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: false,
      content: `Error: ${message}`
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
      return returnToDispatch(state)
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
      return returnToDispatch(state)
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
      const approvalResolvedAnnotation = buildApprovalBatchResolvedAnnotation({
        batchId,
        decisions: approvalBatchResult.decisions,
        approvalItems
      })
      if (!allApproved) {
        const blockedTranscriptEntries = appendBlockedApprovalToolMessages({
          cache: input.cache,
          ctx: input.ctx,
          calls,
          decisions: approvalBatchResult.decisions,
          approvalItems
        })
        await input.ctx.appendMessageLog([
          approvalResolvedAnnotation,
          ...blockedTranscriptEntries
        ])
        input.cache.toolCallCount += calls.length
        return returnToDispatch(state)
      }
      await input.ctx.appendMessageLog([approvalResolvedAnnotation])
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

    const toolTranscript = await appendToolMessages({
      cache: input.cache,
      ctx: input.ctx,
      calls,
      results
    })
    await input.ctx.appendMessageLog(
      toolTranscript.map((entry) => ({
        kind: 'tool' as const,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        ok: entry.ok,
        content: entry.content,
        images: entry.images
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
