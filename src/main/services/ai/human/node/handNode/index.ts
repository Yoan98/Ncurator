import { randomUUID } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
import {
  HUMAN_DEFAULT_TOOL_CALL_LIMIT,
  HUMAN_DOCX_BATCH_WRITE_LIMIT,
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
  'docx_paragraph_edit',
  'docx_heading_edit',
  'docx_table_edit',
  'docx_text_edit',
  'docx_text_style_edit'
])
type DocxContinuationAction = 'insert_before' | 'insert_after'
type DocxAnchorContinuation = {
  action: DocxContinuationAction
  blockId: string
}

const isDocxSerialWriteCall = (toolName: string): boolean => DOCX_SERIAL_WRITE_TOOL_NAMES.has(toolName)
const isTerminalRunCall = (toolName: string): boolean => toolName === 'terminal_run'

const readSourcePathArg = (args: JsonObject): string | undefined =>
  typeof args.sourcePath === 'string' && args.sourcePath.trim().length > 0 ? args.sourcePath : undefined

const readTerminalCommandArg = (args: JsonObject): string | undefined =>
  typeof args.command === 'string' && args.command.trim().length > 0 ? args.command.trim() : undefined

const readDocxContinuationAction = (toolName: string, args: JsonObject): DocxContinuationAction | undefined => {
  if (
    toolName !== 'docx_paragraph_edit' &&
    toolName !== 'docx_heading_edit' &&
    toolName !== 'docx_table_edit'
  ) {
    return undefined
  }
  return args.action === 'insert_before' || args.action === 'insert_after' ? args.action : undefined
}

const rewriteDocxArgsWithResolvedBlocks = (input: {
  args: JsonObject
  resolvedLocators: Array<{
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    blockIds: string[]
  }>
}): JsonObject => {
  const nextArgs: JsonObject = { ...input.args }
  input.resolvedLocators.forEach((locator) => {
    if (locator.field === 'blockIds') {
      nextArgs.blockIds = locator.blockIds
      return
    }
    nextArgs[locator.field] = locator.blockIds[0]
  })
  return nextArgs
}

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
  callCount?: number
  limit?: number
}): HumanDecisionHint => ({
  code: 'hand_plan_invalid',
  detail: {
    mode: input.mode,
    reason: input.reason,
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

const validateToolUsePlan = (toolUsePlan: ToolUsePlan): HumanDecisionHint | undefined => {
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
    const docxWriteCalls = toolUsePlan.calls.filter((item) => isDocxSerialWriteCall(item.toolName))
    if (docxWriteCalls.length > 0) {
      const limit = HUMAN_DOCX_BATCH_WRITE_LIMIT
      if (docxWriteCalls.length > limit) {
        return createHandPlanInvalidDecisionHint({
          mode: 'serial',
          reason: 'docx_batch_write_limit_exceeded',
          offendingToolNames: docxWriteCalls.map((item) => item.toolName),
          callCount: docxWriteCalls.length,
          limit
        })
      }
    }
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

  const executeDocxWriteTransactionSegment = async (
    segmentCalls: ToolUsePlan['calls']
  ): Promise<ToolCallResult[]> => {
    const runtime = input.cache.docxRuntime
    const firstSourcePath = readSourcePathArg(segmentCalls[0]?.args || {})
    if (!runtime || !firstSourcePath) {
      const fallbackResults: ToolCallResult[] = []
      for (const segmentCall of segmentCalls) {
        fallbackResults.push(
          await executeToolCall({
            ctx: input.ctx,
            cache: input.cache,
            taskId: input.taskId,
            learnedSkillIds: input.learnedSkillIds,
            toolName: segmentCall.toolName,
            args: segmentCall.args
          })
        )
      }
      return fallbackResults
    }

    const replay = await runtime.ensureReplaySession({
      toolName: segmentCalls[0].toolName,
      toolCallId: `human-hand-docx-serial:${input.taskId}`,
      sourcePath: firstSourcePath,
      reason: 'edit'
    })
    if ('failure' in replay) {
      return [
        {
          toolName: segmentCalls[0].toolName,
          ok: false,
          code: replay.failure.code,
          data: replay.failure,
          diagnostic: {
            message: replay.failure.error
          },
          resourceContext: replay.failure.resourceContext
        }
      ]
    }

    const resolved = await runtime.resolveSnapshotTargets({
      sourcePath: replay.sourcePath,
      baseRevisionRef: replay.currentRevisionRef,
      toolCalls: segmentCalls.map((call) => ({
        toolName: call.toolName,
        args: call.args
      }))
    })
    if (!resolved.ok) {
      return [
        {
          toolName: segmentCalls[0].toolName,
          ok: false,
          code: 'invalid_input',
          data: {
            ok: false,
            code: 'invalid_input',
            error: resolved.error
          },
          diagnostic: {
            message: resolved.error
          },
          resourceContext: runtime.buildResourceContext({
            sourcePath: replay.sourcePath,
            effectKind: 'mutated',
            currentRevisionRef: replay.currentRevisionRef
          })
        }
      ]
    }

    const segmentResults: ToolCallResult[] = []
    const completedItems: string[] = []
    const anchorContinuationMap = new Map<string, DocxAnchorContinuation>()
    for (let callIndex = 0; callIndex < segmentCalls.length; callIndex += 1) {
      const segmentCall = segmentCalls[callIndex]
      const resolvedCall = resolved.resolvedCalls[callIndex]
      try {
        const argsWithContinuation = { ...segmentCall.args }
        const continuationAction = readDocxContinuationAction(segmentCall.toolName, segmentCall.args)
        const continuationEntry =
          typeof argsWithContinuation.anchorBlockId === 'string' &&
          anchorContinuationMap.has(argsWithContinuation.anchorBlockId)
            ? anchorContinuationMap.get(argsWithContinuation.anchorBlockId)
            : undefined
        const continuationAnchor =
          continuationEntry && continuationEntry.action === continuationAction
            ? continuationEntry.blockId
            : undefined
        if (
          (segmentCall.toolName === 'docx_paragraph_edit' ||
            segmentCall.toolName === 'docx_heading_edit' ||
            segmentCall.toolName === 'docx_table_edit') &&
          continuationAnchor
        ) {
          argsWithContinuation.anchorBlockId = continuationAnchor
        }
        const resolvedLocators = resolvedCall.locators.map((locator) => ({
          field: locator.field,
          blockIds: continuationAnchor && locator.field === 'anchorBlockId'
            ? [continuationAnchor]
            : (() => {
            const current = runtime.resolveLiveBlockIdsFromStableLocators({
              sourcePath: replay.sourcePath,
              field: locator.field,
              stableLocators: locator.stableLocators
            })
            if (!current.ok) {
              throw new Error(current.error)
            }
            return current.blockIds
          })()
        }))
        const nextResult = await executeToolCall({
          ctx: input.ctx,
          cache: input.cache,
          taskId: input.taskId,
          learnedSkillIds: input.learnedSkillIds,
          toolName: segmentCall.toolName,
          args: rewriteDocxArgsWithResolvedBlocks({
            args: argsWithContinuation,
            resolvedLocators
          })
        })
        segmentResults.push(nextResult)
        if (nextResult.ok) {
          completedItems.push(`${segmentCall.toolName}#${String(callIndex + 1)}`)
          const readbackRegions =
            typeof nextResult.data === 'object' &&
            nextResult.data &&
            !Array.isArray(nextResult.data) &&
            Array.isArray((nextResult.data as { postWriteReadback?: { regions?: Array<{ blocks?: Array<{ blockId?: string; type?: string }> }> } }).postWriteReadback?.regions)
              ? (nextResult.data as { postWriteReadback?: { regions?: Array<{ blocks?: Array<{ blockId?: string; type?: string }> }> } }).postWriteReadback?.regions || []
              : []
          const lastCreatedBlockId =
            readbackRegions
              .flatMap((region) => region.blocks || [])
              .filter((block) => block.type !== 'table_cell')
              .slice(-1)[0]?.blockId ||
            readbackRegions.flatMap((region) => region.blocks || []).slice(-1)[0]?.blockId
          if (
            lastCreatedBlockId &&
            typeof segmentCall.args.anchorBlockId === 'string' &&
            segmentCall.args.anchorBlockId.length > 0 &&
            continuationAction
          ) {
            anchorContinuationMap.set(segmentCall.args.anchorBlockId, {
              action: continuationAction,
              blockId: lastCreatedBlockId
            })
          }
          continue
        }

        nextResult.data = {
          ...(typeof nextResult.data === 'object' && nextResult.data !== null && !Array.isArray(nextResult.data)
            ? nextResult.data
            : {}),
          decisionHint: {
            code: 'hand_docx_batch_write_halted',
            detail: {
              sourcePath: replay.sourcePath,
              lastSafeRevisionRef:
                runtime.getReplaySession(replay.sourcePath)?.activeRevisionRef || replay.currentRevisionRef,
              haltedAtCallIndex: callIndex,
              completedCallCount: completedItems.length,
              totalCallCount: segmentCalls.length,
              haltReason: 'locator_confidence_too_low',
              haltSummary: nextResult.diagnostic?.message || 'docx 批量写因定位置信度不足而停止。',
              completedItems,
              pendingItems: segmentCalls
                .slice(callIndex + 1)
                .map((call, pendingIndex) => `${call.toolName}#${String(callIndex + pendingIndex + 2)}`),
              failedItem: `${segmentCall.toolName}#${String(callIndex + 1)}`,
              recoveryContext: `当前工作稿已停在 ${runtime.getReplaySession(replay.sourcePath)?.activeRevisionRef || replay.currentRevisionRef}；已完成写入保留，未完成写入未执行。`
            }
          }
        }
        break
      } catch (error) {
        segmentResults.push({
          toolName: segmentCall.toolName,
          ok: false,
          code: 'invalid_input',
          data: {
            ok: false,
            code: 'invalid_input',
            error: error instanceof Error ? error.message : String(error),
            decisionHint: {
              code: 'hand_docx_batch_write_halted',
              detail: {
                sourcePath: replay.sourcePath,
                lastSafeRevisionRef:
                  runtime.getReplaySession(replay.sourcePath)?.activeRevisionRef || replay.currentRevisionRef,
                haltedAtCallIndex: callIndex,
                completedCallCount: completedItems.length,
                totalCallCount: segmentCalls.length,
                haltReason: 'locator_confidence_too_low',
                haltSummary: error instanceof Error ? error.message : String(error),
                completedItems,
                pendingItems: segmentCalls
                  .slice(callIndex + 1)
                  .map((call, pendingIndex) => `${call.toolName}#${String(callIndex + pendingIndex + 2)}`),
                failedItem: `${segmentCall.toolName}#${String(callIndex + 1)}`,
                recoveryContext: `当前工作稿已停在 ${runtime.getReplaySession(replay.sourcePath)?.activeRevisionRef || replay.currentRevisionRef}；已完成写入保留，未完成写入未执行。`
              }
            }
          },
          diagnostic: {
            message: error instanceof Error ? error.message : String(error)
          },
          resourceContext: runtime.buildResourceContext({
            sourcePath: replay.sourcePath,
            effectKind: 'mutated',
            currentRevisionRef: runtime.getReplaySession(replay.sourcePath)?.activeRevisionRef
          })
        })
        break
      }
    }
    return segmentResults
  }

  const results: ToolCallResult[] = []
  for (let index = 0; index < input.toolUsePlan.calls.length; ) {
    const toolCall = input.toolUsePlan.calls[index]
    const sourcePath = readSourcePathArg(toolCall.args)

    if (sourcePath && isDocxSerialWriteCall(toolCall.toolName)) {
      const segmentCalls = [toolCall]
      let cursor = index + 1
      while (cursor < input.toolUsePlan.calls.length) {
        const candidate = input.toolUsePlan.calls[cursor]
        if (
          !isDocxSerialWriteCall(candidate.toolName) ||
          readSourcePathArg(candidate.args) !== sourcePath
        ) {
          break
        }
        segmentCalls.push(candidate)
        cursor += 1
      }
      results.push(...(await executeDocxWriteTransactionSegment(segmentCalls)))
      index = cursor
    } else {
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
      index += 1
    }

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
