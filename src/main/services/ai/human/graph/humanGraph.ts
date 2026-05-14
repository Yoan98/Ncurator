import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, HumanRunDispatchOptions } from '../../types'
import type { HumanState, HumanTaskInput, HumanTaskOutput } from '../types'
import { createBrainNode } from '../node/brainNode'
import { createContextCompactionNode } from '../node/contextCompactionNode'
import { createContextBudgetNode } from '../node/contextBudgetNode'
import { createLearningNode } from '../node/learningNode'
import { createHandNode } from '../node/handNode'
import { createMouthNode } from '../node/mouthNode'
import { createHumanRuntimeCache } from '../node/utils/runtimeCache'
import { createHumanRunStateSchema, createInitialHumanState } from '../state/schema'

const RECURSION_LIMIT = 60

export const createHumanGraphRunner = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const State = createHumanRunStateSchema()

  return async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions = {}
  ): Promise<HumanTaskOutput> => {
    ctx.beginDocxReviewRun()
    try {
      const cache = createHumanRuntimeCache()
      const contextBudgetNode = createContextBudgetNode({ ctx, cache })
      const contextCompactionNode = createContextCompactionNode({ ctx, cache })
      const brainNode = createBrainNode({ ctx, cache })
      const learningNode = createLearningNode({ ctx, cache })
      const handNode = createHandNode({ ctx, cache })
      const mouthNode = createMouthNode({
        ctx,
        cache,
        emitAnswerEvents: Boolean(options.emitAnswerEvents)
      })

      const graph = new StateGraph(State)
        .addNode('human_context_budget_node', (state) => {
          cache.currentState = state as HumanState
          return contextBudgetNode(state as HumanState)
        })
        .addNode('human_context_compaction_node', (state) => {
          cache.currentState = state as HumanState
          return contextCompactionNode(state as HumanState)
        })
        .addNode('human_brain_node', (state) => {
          cache.currentState = state as HumanState
          return brainNode(state as HumanState)
        })
        .addNode('human_learning_node', (state) => {
          cache.currentState = state as HumanState
          return learningNode(state as HumanState)
        })
        .addNode('human_hand_node', (state) => {
          cache.currentState = state as HumanState
          return handNode(state as HumanState)
        })
        .addNode('human_mouth_node', (state) => {
          cache.currentState = state as HumanState
          return mouthNode(state as HumanState)
        })
        .addEdge(START, 'human_context_budget_node')
        .addConditionalEdges('human_context_budget_node', (state) => {
          const humanState = state as HumanState
          if (humanState.execution.stage === 'context_compaction') {
            return 'human_context_compaction_node'
          }
          return 'human_brain_node'
        })
        .addEdge('human_context_compaction_node', 'human_context_budget_node')
        .addConditionalEdges('human_brain_node', (state) => {
          const humanState = state as HumanState
          if (humanState.execution.stage === 'learning') return 'human_learning_node'
          if (humanState.execution.stage === 'hand') return 'human_hand_node'
          if (humanState.execution.stage === 'mouth') return 'human_mouth_node'
          return 'human_brain_node'
        })
        .addEdge('human_learning_node', 'human_context_budget_node')
        .addEdge('human_hand_node', 'human_context_budget_node')
        .addConditionalEdges('human_mouth_node', (state) => {
          const humanState = state as HumanState
          if (humanState.execution.status === 'running') return 'human_context_budget_node'
          return END
        })
        .compile()

      const output = (await graph.invoke(createInitialHumanState(taskInput) as HumanState, {
        recursionLimit: RECURSION_LIMIT
      })) as HumanState

      return {
        taskId: taskInput.taskId,
        status: output.result?.status || 'completed',
        deliveryMarkdown: output.result?.deliveryMarkdown || '',
        artifacts: output.result?.artifacts
      }
    } catch (error) {
      ctx.discardDocxReviewRun()
      throw error
    }
  }
}
