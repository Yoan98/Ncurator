import { END, START, StateGraph } from '@langchain/langgraph'
import { SystemMessage } from '@langchain/core/messages'
import type { AiRunContext, HumanRunDispatchOptions } from '../../types'
import { HUMAN_GRAPH_RECURSION_LIMIT } from '../constants'
import type { HumanState, HumanTaskInput, HumanTaskOutput } from '../types'
import { createBrainNode } from '../node/brainNode'
import { createContextCompactionNode } from '../node/contextCompactionNode'
import { createContextBudgetNode } from '../node/contextBudgetNode'
import { createLearningNode } from '../node/learningNode'
import { createPlanNode } from '../node/planNode'
import { createHandNode } from '../node/handNode'
import { createHumanRuntimeCache } from '../node/utils/runtimeCache'
import { advanceDispatchState } from '../node/dispatch'
import { createHumanRunStateSchema, createInitialHumanState } from '../state/schema'
import { buildBrainSystemPrompt } from '../prompts/brain'
import { projectMessageLogRecords } from '../memory/transcript'
import { projectBrainMessagesFromLog } from '../memory/brainMessageProjection'
import { isLearnableSkillId } from '../skills'
import {
  classifyThrownErrorToAiRunFailure
} from '../../utils/runFailure'

export const createHumanGraphRunner = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const State = createHumanRunStateSchema()

  return async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions = {}
  ): Promise<HumanTaskOutput> => {
    const cache = createHumanRuntimeCache()
    const runNode = async (
      state: HumanState,
      node: (state: HumanState) => Promise<HumanState>
    ): Promise<HumanState> => {
      cache.currentState = state
      const nextState = await node(state)
      cache.currentState = nextState
      return nextState
    }
    ctx.beginDocxApplyRun()
    try {
      const contextBudgetNode = createContextBudgetNode({ ctx, cache })
      const contextCompactionNode = createContextCompactionNode({ ctx, cache })
      const brainNode = createBrainNode({
        ctx,
        cache,
        emitAnswerEvents: Boolean(options.emitAnswerEvents)
      })
      const learningNode = createLearningNode({ ctx, cache })
      const planNode = createPlanNode({ ctx, cache })
      const handNode = createHandNode({ ctx, cache })

      const routeToolReturn = (state: HumanState): string => {
        if (state.execution.stage === 'context_budget') return 'human_context_budget_node'
        return 'human_dispatch_node'
      }

      const graph = new StateGraph(State)
        .addNode('human_context_budget_node', (state) =>
          runNode(state as HumanState, contextBudgetNode)
        )
        .addNode('human_context_compaction_node', (state) =>
          runNode(state as HumanState, contextCompactionNode)
        )
        .addNode('human_brain_node', (state) => runNode(state as HumanState, brainNode))
        .addNode('human_dispatch_node', (state) => {
          const nextState = advanceDispatchState(state as HumanState)
          cache.currentState = nextState
          return nextState
        })
        .addNode('human_learning_node', (state) =>
          runNode(state as HumanState, learningNode)
        )
        .addNode('human_plan_node', (state) => runNode(state as HumanState, planNode))
        .addNode('human_hand_node', (state) => runNode(state as HumanState, handNode))
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
          if (humanState.execution.status === 'completed') return END
          if (humanState.execution.stage === 'dispatch') return 'human_dispatch_node'
          return 'human_context_budget_node'
        })
        .addConditionalEdges('human_dispatch_node', (state) => {
          const humanState = state as HumanState
          if (humanState.execution.stage === 'learning') return 'human_learning_node'
          if (humanState.execution.stage === 'plan') return 'human_plan_node'
          if (humanState.execution.stage === 'hand') return 'human_hand_node'
          return 'human_context_budget_node'
        })
        .addConditionalEdges('human_learning_node', (state) => routeToolReturn(state as HumanState))
        .addConditionalEdges('human_plan_node', (state) => routeToolReturn(state as HumanState))
        .addConditionalEdges('human_hand_node', (state) => routeToolReturn(state as HumanState))
        .compile()

      const baseInitialState = options.initialState || createInitialHumanState(taskInput)
      cache.currentState = baseInitialState
      const messageLogRecords = await ctx.loadMessageLog()
      const logProjection = projectMessageLogRecords(messageLogRecords)
      const learnedSkillIds = Array.from(new Set(logProjection.learnedSkillIds)).filter(
        isLearnableSkillId
      )
      const initialState: HumanState = {
        ...baseInitialState,
        task: options.initialState?.task || taskInput,
        memory: {
          plan: logProjection.plan,
          compactions: []
        },
        skills: {
          learnedSkillIds
        }
      }
      cache.currentState = initialState
      cache.currentUserLogAppended = false
      const brainProjection = projectBrainMessagesFromLog({
        records: messageLogRecords,
        ctx,
        state: initialState
      })
      cache.messages = [
        new SystemMessage(buildBrainSystemPrompt({ ctx })),
        ...brainProjection.messages
      ]
      cache.currentUserMessageIndex = brainProjection.currentUserMessageIndex + 1
      const output = (await graph.invoke(initialState as HumanState, {
        recursionLimit:
          ctx.humanRuntimeOverrides?.graphRecursionLimit || HUMAN_GRAPH_RECURSION_LIMIT
      })) as HumanState

      return {
        taskId: taskInput.taskId,
        status: output.result?.status || 'completed',
        deliveryMarkdown: output.result?.deliveryMarkdown || '',
        artifacts: output.result?.artifacts
      }
    } catch (error) {
      ctx.discardDocxApplyRun()
      throw classifyThrownErrorToAiRunFailure(error, cache.currentState)
    }
  }
}
