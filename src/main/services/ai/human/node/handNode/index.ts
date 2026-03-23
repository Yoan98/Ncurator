import { HUMAN_DEFAULT_TOOL_CALL_LIMIT } from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { validateParallelToolCalls } from './actionBatchGuard'
import { executeToolCall } from './toolExecutor'
import { buildInvalidBatchHint, buildToolLimitHint } from './watchHint'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

export const createHandNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const toolCallLimit =
      input.ctx.humanRuntimeOverrides?.hardActionLimit || HUMAN_DEFAULT_TOOL_CALL_LIMIT

    if (!state.lastBrainDecision || state.lastBrainDecision.nextAction.action !== 'hand') {
      return returnToBrain(state)
    }

    const parallelCallToolParam = state.lastBrainDecision.nextAction.parallelCallToolParam
    if (!validateParallelToolCalls(parallelCallToolParam)) {
      const watchHint = buildInvalidBatchHint()
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'hand',
        watchHint
      })
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

    const watchHint =
      input.cache.toolCallCount > toolCallLimit
        ? buildToolLimitHint(input.cache.toolCallCount, toolCallLimit)
        : undefined
    const runtimeArtifacts = mergeArtifactRefs(
      state.runtimeArtifacts,
      extractArtifactRefsFromToolResults(results)
    )
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      source: 'hand',
      traceItems: results.map((result) => ({
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
      })),
      stage: 'human_hand',
      watchHint,
      overrides: {
        lastParallelCallToolResults: results,
        runtimeArtifacts
      }
    })
    return nextState
  }
}
