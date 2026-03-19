import { END, START, StateGraph } from '@langchain/langgraph'
import type {
  AiTaskResultCode,
  HumanTaskInput,
  HumanTaskOutput
} from '../../../../shared/types'
import type { AiRunContext, HumanRunDispatchOptions } from '../types'
import {
  createHumanExecuteNode,
  createHumanFinalizeNode,
  createHumanRuntimeCache,
  createHumanReasonNode,
  createInitialHumanState,
  createWatchdogSidecar,
  type HumanState
} from '../node/human'
import { createHumanRunStateSchema } from '../state/stateSchemas'

const RECURSION_LIMIT = 96

const resolveOutputCode = (input: {
  state: HumanState
  forcedByWatchdog: boolean
}): AiTaskResultCode => {
  const { state, forcedByWatchdog } = input
  if (state.outcome?.status === 'completed') return 'ok'
  const lastObservation = state.turn.incoming?.observations.at(-1)
  if (lastObservation && lastObservation.kind === 'tool_result' && lastObservation.code !== 'ok') {
    return lastObservation.code
  }
  if (forcedByWatchdog) return 'bounded_loop_error'
  return 'failed'
}

export const createHumanGraphRunner = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const State = createHumanRunStateSchema()

  return async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions = {}
  ): Promise<HumanTaskOutput> => {
    const cache = createHumanRuntimeCache()
    const watchdog = createWatchdogSidecar({
      ctx,
      taskId: taskInput.taskId,
      hardActionLimit: Math.max(1, Number(ctx.humanRuntimeOverrides?.hardActionLimit ?? 12))
    })

    const reasonNode = createHumanReasonNode({
      ctx,
      cache,
      watchdog
    })
    const executeNode = createHumanExecuteNode({
      ctx,
      cache
    })
    const finalizeNode = createHumanFinalizeNode({
      ctx,
      streamAnswer: Boolean(options.streamAnswer),
      internalDelivery: Boolean(options.internalDelivery),
      wasForcedByWatchdog: () => watchdog.wasHardRequested()
    })

    const graph = new StateGraph(State)
      .addNode('human_reason_node', (state: HumanState) => reasonNode(state))
      .addNode('human_execute_node', (state: HumanState) => executeNode(state))
      .addNode('human_finalize_node', (state: HumanState) => finalizeNode(state))
      .addEdge(START, 'human_reason_node')
      .addConditionalEdges('human_reason_node', (state: HumanState) => {
        if (state.progress.phase === 'executing') return 'human_execute_node'
        if (state.progress.phase === 'finalizing') return 'human_finalize_node'
        return END
      })
      .addEdge('human_execute_node', 'human_reason_node')
      .addEdge('human_finalize_node', END)
      .compile()

    const output = (await graph.invoke(
      createInitialHumanState({
        task: taskInput,
        allowNonLocal: ctx.allowNonLocal
      }) as HumanState,
      {
        recursionLimit: RECURSION_LIMIT
      }
    )) as HumanState

    return {
      taskId: taskInput.taskId,
      status: output.outcome?.status || 'blocked',
      summary: output.outcome?.summary || '任务未产出终态结果。',
      deliveryMarkdown: output.outcome?.presentation?.markdown || '',
      resultCode: resolveOutputCode({
        state: output,
        forcedByWatchdog: watchdog.wasHardRequested()
      }),
      resultData: output.outcome?.payload,
      localSourceStatus: output.outcome?.provenance?.localSourceStatus,
      localSourceSummary: output.outcome?.provenance?.localSourceSummary
    }
  }
}
