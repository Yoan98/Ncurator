import { getToolDisplayInput } from '../../../../../../shared/assistantToolCopy'
import { randomUUID } from 'node:crypto'
import type {
  ChatMessageImageRef,
  ChatMessageLogEntry,
  JsonObject
} from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { emitToolProcessCompleted, emitToolProcessStarted } from '../../../events/processEvents'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import { buildModelToolResultDelivery } from '../../shared/modelToolResult'
import { buildToolFeedback } from '../../shared/toolFeedback'
import { resolveToolErrorMessage } from '../../shared/toolError'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { assertExternalLoadedToolsetIds } from '../../toolsets'
import { analyzeTerminalCommandPolicy } from '../../tools/terminal/commandPolicy'
import type { HumanRuntimeCache, HumanState, ToolCallResult } from '../../types'
import { executeToolCall } from './toolExecutor'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'
import { appendLogEntriesToCache } from '../../memory/conversationLogMessages'
import {
  buildTerminalReviewAnnotation,
  buildTerminalReviewStartedAnnotation,
  reviewTerminalCommands,
  type TerminalReviewCandidate
} from './terminalReview'

const isTerminalRunCall = (toolName: string): boolean => toolName === 'terminal_run'

const readTerminalCommandArg = (args: JsonObject): string | undefined =>
  typeof args.command === 'string' && args.command.trim().length > 0
    ? args.command.trim()
    : undefined

const readCommandExplanationArg = (args: JsonObject): string | undefined =>
  typeof args.commandExplanation === 'string' && args.commandExplanation.trim().length > 0
    ? args.commandExplanation.trim()
    : undefined

type ParsedHandCall = {
  toolCallId: string
  toolName: string
  args: JsonObject
}

const collectApprovalBatchItems = (input: {
  calls: ParsedHandCall[]
  platform: AiRunContext['platform']
}): Array<
  TerminalReviewCandidate & {
    commandExplanation: string
    itemId: string
    order: number
    toolName: string
    reason: string
  }
> => {
  return input.calls.flatMap((call, index) => {
    if (isTerminalRunCall(call.toolName)) {
      const command = readTerminalCommandArg(call.args)
      if (!command) return []
      const riskPolicy = analyzeTerminalCommandPolicy(command, input.platform)
      if (riskPolicy.executionPolicy === 'auto_allow') return []
      return [
        {
          commandId: call.toolCallId,
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

const executeHandCalls = async (input: {
  calls: ParsedHandCall[]
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  loadedToolsetIds: HumanState['toolsets']['loadedToolsetIds']
}): Promise<ToolCallResult[]> => {
  const results: ToolCallResult[] = []
  for (const toolCall of input.calls) {
    results.push(
      await executeToolCall({
        ctx: input.ctx,
        cache: input.cache,
        taskId: input.taskId,
        loadedToolsetIds: input.loadedToolsetIds,
        toolCallId: toolCall.toolCallId,
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
    displayInput?: JsonObject
    error?: string
    images?: ChatMessageImageRef[]
  }>
> => {
  const transcriptEntries: Array<{
    toolCallId: string
    toolName: string
    ok: boolean
    content: string
    displayInput?: JsonObject
    error?: string
    images?: ChatMessageImageRef[]
  }> = []
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
    transcriptEntries.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: delivery.ok,
      content: delivery.content,
      displayInput: getToolDisplayInput(call.toolName, call.args, result.data),
      error: delivery.ok
        ? undefined
        : !result.ok
          ? resolveToolErrorMessage(call.toolName, result.data)
          : delivery.content,
      images: result.ok ? result.imageRefs : undefined
    })
  }
  appendLogEntriesToCache(
    input.cache,
    transcriptEntries.map((entry) => ({
      kind: 'tool' as const,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      ok: entry.ok,
      content: entry.content,
      displayInput: entry.displayInput,
      error: entry.error,
      images: entry.images
    }))
  )
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
  notExecutedToolCallIds?: string[]
  approvalItems: Array<{
    itemId: string
    toolName: string
    command: string
    commandExplanation: string
  }>
}): ChatMessageLogEntry => {
  const decisionByItemId = new Map(input.decisions.map((decision) => [decision.itemId, decision]))
  return {
    kind: 'annotation',
    eventType: 'approval_batch_resolved',
    payload: {
      batchId: input.batchId,
      notExecutedToolCallIds: input.notExecutedToolCallIds,
      items: input.approvalItems.map((item) => {
        const decision = decisionByItemId.get(item.itemId)
        return {
          toolCallId: item.itemId,
          toolName: item.toolName,
          command: item.command,
          commandExplanation: item.commandExplanation,
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
      args: call.args,
      terminalReviewState: isTerminalRunCall(call.toolName) ? 'not_executed' : undefined
    })
    emitToolProcessCompleted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: false,
      error: message
    })
    transcriptEntries.push(
      buildToolFeedback({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        ok: false,
        errorMessage: message,
        content: `Error: ${message}`
      })
    )
  })

  appendLogEntriesToCache(input.cache, transcriptEntries)
  return transcriptEntries
}

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLoadedToolsetIds(state.toolsets.loadedToolsetIds)
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

    const reviewCandidates =
      input.ctx.executionPermission === 'full_access'
        ? []
        : collectApprovalBatchItems({
            calls,
            platform: input.ctx.platform
          })

    let approvalItems: typeof reviewCandidates = []
    if (reviewCandidates.length > 0) {
      const reviewId = randomUUID()
      const reviewStartedAt = Date.now()
      await input.ctx.appendMessageLog([
        buildTerminalReviewStartedAnnotation({ reviewId, commands: reviewCandidates })
      ])
      input.ctx.sendEvent({
        type: 'terminal_review_started',
        runId: input.ctx.runId,
        reviewId,
        commands: reviewCandidates.map((candidate) => ({
          commandId: candidate.commandId,
          input: calls.find((call) => call.toolCallId === candidate.commandId)?.args || {}
        })),
        createdAt: reviewStartedAt
      })
      const reviewResult = await reviewTerminalCommands({
        ctx: input.ctx,
        taskId: state.task.taskId,
        userInput: state.task.userInput,
        commands: reviewCandidates
      })
      await input.ctx.appendMessageLog([
        buildTerminalReviewAnnotation({ reviewId, result: reviewResult })
      ])
      input.ctx.sendEvent({
        type: 'terminal_review_resolved',
        runId: input.ctx.runId,
        reviewId,
        decisions: reviewResult.decisions.map(({ commandId, decision }) => ({
          commandId,
          decision
        })),
        completedAt: Date.now()
      })
      const decisionById = new Map(
        reviewResult.decisions.map((decision) => [decision.commandId, decision])
      )
      approvalItems = reviewCandidates.filter(
        (candidate) => decisionById.get(candidate.commandId)?.decision !== 'auto_approve'
      )
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
      const notExecutedToolCallIds = allApproved
        ? undefined
        : calls.filter((call) => isTerminalRunCall(call.toolName)).map((call) => call.toolCallId)
      const approvalResolvedAnnotation = buildApprovalBatchResolvedAnnotation({
        batchId,
        decisions: approvalBatchResult.decisions,
        approvalItems,
        notExecutedToolCallIds
      })
      if (!allApproved) {
        const blockedTranscriptEntries = appendBlockedApprovalToolMessages({
          cache: input.cache,
          ctx: input.ctx,
          calls,
          decisions: approvalBatchResult.decisions,
          approvalItems
        })
        await input.ctx.appendMessageLog([approvalResolvedAnnotation, ...blockedTranscriptEntries])
        if (notExecutedToolCallIds?.length) {
          input.ctx.sendEvent({
            type: 'terminal_review_blocked',
            runId: input.ctx.runId,
            toolCallIds: notExecutedToolCallIds,
            createdAt: Date.now()
          })
        }
        input.cache.toolCallCount += calls.length
        return returnToDispatch(state)
      }
      await input.ctx.appendMessageLog([approvalResolvedAnnotation])
    }

    const results = await executeHandCalls({
      calls,
      ctx: input.ctx,
      cache: input.cache,
      taskId: state.task.taskId,
      loadedToolsetIds: state.toolsets.loadedToolsetIds
    })
    const readyState = input.cache.currentState || state
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
        displayInput: entry.displayInput,
        error: entry.error,
        images: entry.images
      }))
    )

    const artifacts = mergeArtifactRefs(
      readyState.execution.artifacts,
      extractArtifactRefsFromToolResults(results)
    )
    return returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
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
