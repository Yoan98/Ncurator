import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, HumanRunDispatchOptions } from '../../types'
import type { HumanState, HumanTaskInput, HumanTaskOutput } from '../types'
import { createBrainNode } from '../node/brainNode'
import { createLearningNode } from '../node/learningNode'
import { createHandNode } from '../node/handNode'
import { createMouthNode } from '../node/mouthNode'
import { createInitialHumanState } from '../node/utils/initialState'
import { createHumanRuntimeCache } from '../node/utils/runtimeCache'
import { createHumanRunStateSchema } from '../state/schema'

const RECURSION_LIMIT = 128

export const createHumanGraphRunner = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const State = createHumanRunStateSchema()

  return async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions = {}
  ): Promise<HumanTaskOutput> => {
    const cache = createHumanRuntimeCache()
    const brainNode = createBrainNode({ ctx, cache })
    const learningNode = createLearningNode({ ctx, cache })
    const handNode = createHandNode({ ctx, cache })
    const mouthNode = createMouthNode({
      ctx,
      cache,
      deliveryMode: options.deliveryMode || 'user_answer',
      streamAnswer: Boolean(options.streamAnswer),
      internalDelivery: Boolean(options.internalDelivery)
    })

    const graph = new StateGraph(State)
      .addNode('human_brain_node', (state) => brainNode(state as HumanState))
      .addNode('human_learning_node', (state) => learningNode(state as HumanState))
      .addNode('human_hand_node', (state) => handNode(state as HumanState))
      .addNode('human_mouth_node', (state) => mouthNode(state as HumanState))
      .addEdge(START, 'human_brain_node')
      .addConditionalEdges('human_brain_node', (state) => {
        const humanState = state as HumanState
        if (humanState.runtime.stage === 'learning') return 'human_learning_node'
        if (humanState.runtime.stage === 'hand') return 'human_hand_node'
        if (humanState.runtime.stage === 'mouth') return 'human_mouth_node'
        return 'human_brain_node'
      })
      .addEdge('human_learning_node', 'human_brain_node')
      .addEdge('human_hand_node', 'human_brain_node')
      .addConditionalEdges('human_mouth_node', (state) => {
        const humanState = state as HumanState
        if (humanState.runtime.status === 'running') return 'human_brain_node'
        return END
      })
      .compile()

    const output = (await graph.invoke(createInitialHumanState(taskInput) as HumanState, {
      recursionLimit: RECURSION_LIMIT
    })) as HumanState

    return {
      taskId: taskInput.taskId,
      status: output.result?.status || 'blocked',
      summary: output.result?.summary || '任务未产出最终结果。',
      deliveryMarkdown: output.result?.deliveryMarkdown
    }
  }
}
