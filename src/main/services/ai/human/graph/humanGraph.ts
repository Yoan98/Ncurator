import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, HumanRunDispatchOptions } from '../../types'
import { HUMAN_GRAPH_RECURSION_LIMIT } from '../constants'
import type { HumanState, HumanTaskInput, HumanTaskOutput } from '../types'
import { createBrainNode } from '../node/brainNode'
import { createContextCompactionNode } from '../node/contextCompactionNode'
import { createContextBudgetNode } from '../node/contextBudgetNode'
import { createLearningNode } from '../node/learningNode'
import { createHandNode } from '../node/handNode'
import { createMouthNode } from '../node/mouthNode'
import { createFaultNode } from '../node/faultNode'
import { createHumanRuntimeCache } from '../node/utils/runtimeCache'
import { emitDecisionHint } from '../node/utils/stateTransitionEvents'
import { createHumanRunStateSchema, createInitialHumanState } from '../state/schema'
import { isLearnableSkillId } from '../skills'
import {
  classifyLlmFailureCode,
  createRecoverableHumanRunError,
  isCancelledError,
  isRecoverableRunErrorCode,
  isGraphRuntimeLimitError
} from '../../utils/runFailure'

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
    const saveProcessSnapshot = async (state: HumanState): Promise<void> => {
      try {
        await ctx.saveResumeSnapshot({
          reason: 'process_interrupted',
          humanState: state,
          errorMessage: '运行中断恢复快照'
        })
      } catch (error) {
        console.error('[AI-RUN] save process resume snapshot failed:', error)
      }
    }
    const runNodeWithSnapshot = async (
      state: HumanState,
      node: (state: HumanState) => Promise<HumanState>
    ): Promise<HumanState> => {
      cache.currentState = state
      const nextState = await node(state)
      cache.currentState = nextState
      await saveProcessSnapshot(nextState)
      return nextState
    }
    ctx.beginDocxApplyRun()
    try {
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
      const faultNode = createFaultNode({ ctx, cache })

      const graph = new StateGraph(State)
        .addNode('human_context_budget_node', (state) =>
          runNodeWithSnapshot(state as HumanState, contextBudgetNode)
        )
        .addNode('human_context_compaction_node', (state) =>
          runNodeWithSnapshot(state as HumanState, contextCompactionNode)
        )
        .addNode('human_brain_node', (state) => runNodeWithSnapshot(state as HumanState, brainNode))
        .addNode('human_learning_node', (state) =>
          runNodeWithSnapshot(state as HumanState, learningNode)
        )
        .addNode('human_hand_node', (state) => runNodeWithSnapshot(state as HumanState, handNode))
        .addNode('human_mouth_node', (state) => runNodeWithSnapshot(state as HumanState, mouthNode))
        .addNode('human_fault_node', (state) => runNodeWithSnapshot(state as HumanState, faultNode))
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
          return 'human_fault_node'
        })
        .addEdge('human_learning_node', 'human_context_budget_node')
        .addEdge('human_hand_node', 'human_context_budget_node')
        .addEdge('human_fault_node', 'human_context_budget_node')
        .addConditionalEdges('human_mouth_node', (state) => {
          const humanState = state as HumanState
          if (humanState.execution.status === 'running') return 'human_context_budget_node'
          return END
        })
        .compile()

      const baseInitialState = options.initialState || createInitialHumanState(taskInput)
      cache.currentState = baseInitialState
      const sessionSkillState = await ctx.loadSessionSkillState()
      const learnedSkillIds = Array.from(new Set(sessionSkillState.learnedSkillIds)).filter(
        isLearnableSkillId
      )
      const initialState: HumanState = {
        ...baseInitialState,
        task: options.initialState?.task || taskInput,
        skills: {
          learnedSkillIds
        }
      }
      cache.currentState = initialState
      await saveProcessSnapshot(initialState)
      if (initialState.execution.pendingDecisionHint?.code === 'run_resumed_after_interruption') {
        emitDecisionHint({
          ctx,
          taskId: initialState.task.taskId,
          source: 'brain',
          decisionHint: initialState.execution.pendingDecisionHint
        })
      }
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
