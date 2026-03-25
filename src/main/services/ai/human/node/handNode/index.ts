import { HUMAN_DEFAULT_TOOL_CALL_LIMIT } from '../../constants'
import type { AiRunContext } from '../../../types'
import { extractArtifactRefsFromToolResults, mergeArtifactRefs } from '../../../utils/artifacts'
import type { HumanRuntimeCache, HumanState, ToolCallParam } from '../../types'
import { canBatchPlan } from './toolExecutionMeta'
import { executeToolCall } from './toolExecutor'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

const MAX_PARALLEL_TOOL_CALLS = 4

const validateParallelToolCalls = (parallelCallToolParam: ToolCallParam[]): boolean => {
  return canBatchPlan({
    actions: parallelCallToolParam.map((item) => ({
      toolName: item.toolName,
      args: item.args
    })),
    maxParallel: MAX_PARALLEL_TOOL_CALLS
  })
}

const buildInvalidBatchHint = () =>
  'hand 收到不满足并行安全要求的工具批次，已返回 brain 重新决策。'

const buildToolLimitHint = (toolCallCount: number, limit: number) =>
  `hand 累计工具调用次数达到 ${toolCallCount}，已超过临时上限 ${limit}，请优先考虑收敛。`

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
        action: 'call_tool',
        publicNarrative: result.summary,
        resultStatus: result.code === 'ok' ? 'ok' : 'error',
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
