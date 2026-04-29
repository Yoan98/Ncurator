import type { JsonObject } from '../../../../../../shared/types'
import { HUMAN_DEFAULT_TOOL_CALL_LIMIT, HUMAN_MAX_PARALLEL_TOOL_CALLS } from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import {
  appendDecisionRound,
  buildHandExecution,
  readLoadedHistoryContextFromToolResults
} from '../../memory/roundHistory'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { buildToolCallDisplayText } from '../../shared/toolResultRenderers'
import { getToolSpec } from '../../tools/registry'
import type { ToolExecutionMeta } from '../../tools/types'
import type { HumanRuntimeCache, HumanState, HumanWatchHint, ToolCallResult, ToolUsePlan } from '../../types'
import { assertExternalLearnedSkillIds } from '../../skills'
import { executeToolCall } from './toolExecutor'
import { deriveHandFollowupSignals, shouldStopSerialHandPlan } from './followupSignals'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

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

const createHandPlanInvalidWatchHint = (input: {
  mode: ToolUsePlan['mode']
  reason: Extract<HumanWatchHint, { code: 'hand_plan_invalid' }>['detail']['reason']
  offendingToolNames: string[]
  callCount?: number
  limit?: number
}): HumanWatchHint => ({
  code: 'hand_plan_invalid',
  detail: {
    mode: input.mode,
    reason: input.reason,
    offendingToolNames: input.offendingToolNames,
    callCount: input.callCount,
    limit: input.limit
  }
})

const buildToolLimitWatchHint = (toolCallCount: number, limit: number): HumanWatchHint => ({
  code: 'hand_tool_limit_exceeded',
  detail: {
    toolCallCount,
    limit
  }
})

const validateToolUsePlan = (toolUsePlan: ToolUsePlan): HumanWatchHint | undefined => {
  if (toolUsePlan.mode === 'serial') return undefined
  if (toolUsePlan.calls.length > HUMAN_MAX_PARALLEL_TOOL_CALLS) {
    return createHandPlanInvalidWatchHint({
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
    ? createHandPlanInvalidWatchHint({
        mode: 'parallel',
        reason: 'parallel_requires_read_only',
        offendingToolNames
      })
    : undefined
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

  const results: Awaited<ReturnType<typeof executeToolCall>>[] = []
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

    if (!state.execution.currentDecision || state.execution.currentDecision.nextAction.action !== 'hand') {
      return returnToBrain(state)
    }

    const { toolUsePlan } = state.execution.currentDecision.nextAction
    const invalidPlanWatchHint = validateToolUsePlan(toolUsePlan)
    if (invalidPlanWatchHint) {
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'hand',
        watchHint: invalidPlanWatchHint,
        overrides: {
          memory: {
            ...state.memory,
            history: appendDecisionRound({
              state,
              execution: buildHandExecution({
                toolUsePlan,
                toolResults: [],
                watchHint: invalidPlanWatchHint
              })
            })
          }
        }
      })
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
    const toolLimitWatchHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitWatchHint(input.cache.toolCallCount, toolCallLimit)
        : undefined
    const watchHint = followupSignals.watchHint || toolLimitWatchHint
    const artifacts = mergeArtifactRefs(
      state.execution.artifacts,
      extractArtifactRefsFromToolResults(results)
    )
    const loadedHistoryContext = readLoadedHistoryContextFromToolResults(results)
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
      watchHint,
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
          history: {
            ...appendDecisionRound({
              state,
              execution: buildHandExecution({
                toolUsePlan,
                toolResults: results,
                watchHint
              })
            }),
            loadedHistoryContext
          }
        }
      }
    })
    return nextState
  }
}
