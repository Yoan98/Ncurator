import { HUMAN_DEFAULT_TOOL_CALL_LIMIT } from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendHumanTraceStep, emitHumanStep, emitWatchHint } from '../utils/events'
import { validateParallelToolCalls } from './actionBatchGuard'
import { executeToolCall, getLearnedToolNames } from './toolExecutor'
import { buildInvalidBatchHint, buildToolLimitHint } from './watchHint'

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const toolCallLimit =
      input.ctx.humanRuntimeOverrides?.hardActionLimit || HUMAN_DEFAULT_TOOL_CALL_LIMIT

    if (!state.lastBrainDecision || state.lastBrainDecision.nextAction.action !== 'hand') {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          stage: 'brain'
        }
      }
    }

    const parallelCallToolParam = state.lastBrainDecision.nextAction.parallelCallToolParam
    if (!validateParallelToolCalls(parallelCallToolParam)) {
      const watchHint = buildInvalidBatchHint()
      emitWatchHint({
        ctx: input.ctx,
        taskId: state.task.taskId,
        source: 'hand',
        summary: watchHint
      })
      return {
        ...state,
        runtime: {
          ...state.runtime,
          stage: 'brain'
        },
        watchHint
      }
    }

    const learnedSkillIds = state.brainMemory.outside.learnedSkillIds
    const results = await Promise.all(
      parallelCallToolParam.map((toolCall) =>
        executeToolCall({
          ctx: input.ctx,
          cache: input.cache,
          taskId: state.task.taskId,
          learnedSkillIds,
          toolName: toolCall.toolName,
          args: toolCall.args
        })
      )
    )
    input.cache.toolCallCount += results.length

    let traceSteps = state.trace.steps
    results.forEach((result) => {
      traceSteps = appendHumanTraceStep({
        steps: traceSteps,
        action: result.code === 'ok' ? 'call_tool' : 'block_result',
        publicNarrative: result.summary,
        resultStatus:
          result.code === 'ok'
            ? 'ok'
            : result.code === 'workspace_required' || result.code === 'approval_denied'
              ? 'blocked'
              : 'error',
        toolName: result.toolName,
        summary: result.summary
      })
    })
    const watchHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitHint(input.cache.toolCallCount, toolCallLimit)
        : undefined
    if (watchHint) {
      emitWatchHint({
        ctx: input.ctx,
        taskId: state.task.taskId,
        source: 'hand',
        summary: watchHint
      })
    }
    const runtimeArtifacts = mergeArtifactRefs(
      state.runtimeArtifacts,
      extractArtifactRefsFromToolResults(results)
    )
    const nextState: HumanState = {
      ...state,
      runtime: {
        ...state.runtime,
        stage: 'brain'
      },
      lastParallelCallToolResults: results,
      watchHint,
      runtimeArtifacts,
      trace: {
        steps: traceSteps
      }
    }
    const availableToolNames = getLearnedToolNames({
      learnedSkillIds,
      cache: input.cache
    })
    results.forEach((_, index) => {
      const step = nextState.trace.steps.at(nextState.trace.steps.length - results.length + index)
      if (!step) return
      emitHumanStep({
        ctx: input.ctx,
        taskId: state.task.taskId,
        step,
        learnedSkillIds,
        availableToolNames,
        stage: 'human_hand'
      })
    })
    return nextState
  }
}
