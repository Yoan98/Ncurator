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
import { buildBrainSystemPrompt, buildBrainUserMessage } from '../prompts/brain'
import { projectMessageLogRecords } from '../memory/transcript'
import { createCurrentBrainUserMessage } from '../node/utils/messageTail'
import { isLearnableSkillId } from '../skills'
import {
  classifyLlmFailureCode,
  createRecoverableHumanRunError,
  isCancelledError,
  isRecoverableRunErrorCode,
  isGraphRuntimeLimitError
} from '../../utils/runFailure'
import { isLlmInputTooLongError, isLlmOutputTruncatedError } from '../../errors'

export const HUMAN_GRAPH_INVOKE_CONFIG = {
  recursionLimit: HUMAN_GRAPH_RECURSION_LIMIT
} as const

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
      const sessionSkillState = await ctx.loadSessionSkillState()
      const messageLogRecords = await ctx.loadMessageLog()
      const logProjection = projectMessageLogRecords(messageLogRecords)
      const learnedSkillIds = Array.from(new Set(sessionSkillState.learnedSkillIds)).filter(
        isLearnableSkillId
      )
      const initialState: HumanState = {
        ...baseInitialState,
        task: options.initialState?.task || taskInput,
        memory: {
          plan: logProjection.plan,
          compactions: logProjection.checkpoint
            ? [
                {
                  id: logProjection.checkpoint.compactBlockId,
                  kind: 'compacted_history',
                  summary: logProjection.checkpoint.summary,
                  createdAt: logProjection.checkpoint.createdAt
                }
              ]
            : []
        },
        skills: {
          learnedSkillIds
        }
      }
      cache.currentState = initialState
      cache.messageLogRecords = messageLogRecords
      cache.currentUserLogAppended = false
      const currentUserMessage = createCurrentBrainUserMessage(
        buildBrainUserMessage({
          state: initialState,
          ctx,
          injectPlan: initialState.memory.plan.length > 0
        })
      )
      cache.messages = [
        new SystemMessage(buildBrainSystemPrompt({ ctx })),
        ...logProjection.messages,
        currentUserMessage
      ]
      cache.currentUserMessageIndex = cache.messages.length - 1
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
      if (isCancelledError(error)) {
        throw createRecoverableHumanRunError({
          reason: 'user_cancelled',
          error,
          lastHumanState: cache.currentState
        })
      }
      if (isGraphRuntimeLimitError(error)) {
        throw createRecoverableHumanRunError({
          reason: 'runtime_limit',
          error,
          lastHumanState: cache.currentState
        })
      }
      if (isLlmOutputTruncatedError(error)) {
        throw createRecoverableHumanRunError({
          reason: 'output_truncated',
          error,
          lastHumanState: cache.currentState
        })
      }
      if (isLlmInputTooLongError(error)) throw error
      {
        const code = classifyLlmFailureCode(error)
        if (isRecoverableRunErrorCode(code)) {
          throw createRecoverableHumanRunError({
            reason: code,
            error,
            lastHumanState: cache.currentState
          })
        }
      }
      throw createRecoverableHumanRunError({
        reason: 'unexpected_error',
        error,
        lastHumanState: cache.currentState
      })
    }
  }
}
