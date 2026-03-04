import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, AiRunState } from '../types'
import { createHumanGraphRunner } from './humanGraph'
import { createIntentNode } from '../node/main/intentNode'
import { createContextEnrichNode } from '../node/main/contextEnrichNode'
import { createPlanNode } from '../node/main/planNode'
import { createPlanExecNode } from '../node/main/planExecNode'
import { createFinalizeNode } from '../node/main/finalizeNode'
import { DEFAULT_MAX_CONTEXT_ROUNDS } from '../node/main/helpers'
import { createMainRunStateSchema } from '../state/stateSchemas'

export const buildMainGraph = (input: { ctx: AiRunContext; maxContextRounds?: number }) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))
  const State = createMainRunStateSchema()
  const runHumanTask = createHumanGraphRunner({ ctx })

  const intentNode = createIntentNode({ ctx, maxContextRounds })
  const contextEnrichNode = createContextEnrichNode({ ctx, runHumanTask })
  const planNode = createPlanNode({ ctx })
  const planExecNode = createPlanExecNode({ ctx, runHumanTask })
  const finalizeNode = createFinalizeNode({ ctx })

  return new StateGraph(State)
    .addNode('main_intent_node', (state: AiRunState) => intentNode(state))
    .addNode('main_context_enrich_node', (state: AiRunState) => contextEnrichNode(state))
    .addNode('main_plan_node', (state: AiRunState) => planNode(state))
    .addNode('main_plan_exec_node', (state: AiRunState) => planExecNode(state))
    .addNode('main_finalize_node', (state: AiRunState) => finalizeNode(state))
    .addEdge(START, 'main_intent_node')
    .addConditionalEdges('main_intent_node', (state: AiRunState) => {
      if (state.mainStage === 'main_context_enrich') return 'main_context_enrich_node'
      if (state.mainStage === 'main_plan') return 'main_plan_node'
      if (state.mainStage === 'main_plan_exec') return 'main_plan_exec_node'
      return 'main_finalize_node'
    })
    .addEdge('main_context_enrich_node', 'main_intent_node')
    .addEdge('main_plan_node', 'main_plan_exec_node')
    .addConditionalEdges('main_plan_exec_node', (state: AiRunState) => {
      if (state.mainStage === 'main_plan_exec' && state.status === 'running')
        return 'main_plan_exec_node'
      return 'main_finalize_node'
    })
    .addEdge('main_finalize_node', END)
    .compile()
}
