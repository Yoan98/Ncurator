import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, AiRunState } from '../types'
import { createHumanGraphRunner } from './humanGraph'
import { createMainIntentNode } from '../node/main/intentNode'
import { createMainContextDispatchNode } from '../node/main/contextDispatchNode'
import { createMainPlanNode } from '../node/main/planNode'
import { createMainDispatchNode } from '../node/main/dispatchNode'
import { createMainFinalizeNode } from '../node/main/finalizeNode'
import { DEFAULT_MAX_CONTEXT_ROUNDS } from '../node/main/helpers'
import { createMainRunStateSchema } from '../state/stateSchemas'

export const buildMainGraph = (input: { ctx: AiRunContext; maxContextRounds?: number }) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))
  const State = createMainRunStateSchema()
  const runHumanTask = createHumanGraphRunner({ ctx })

  const intentNode = createMainIntentNode({ ctx, maxContextRounds })
  const contextEnrichNode = createMainContextDispatchNode({ ctx, runHumanTask })
  const planNode = createMainPlanNode({ ctx })
  const dispatchNode = createMainDispatchNode({ ctx, runHumanTask })
  const finalizeNode = createMainFinalizeNode({ ctx })

  return new StateGraph(State)
    .addNode('main_intent_node', (state: AiRunState) => intentNode(state))
    .addNode('main_context_enrich_node', (state: AiRunState) => contextEnrichNode(state))
    .addNode('main_plan_node', (state: AiRunState) => planNode(state))
    .addNode('main_dispatch_node', (state: AiRunState) => dispatchNode(state))
    .addNode('main_finalize_node', (state: AiRunState) => finalizeNode(state))
    .addEdge(START, 'main_intent_node')
    .addConditionalEdges('main_intent_node', (state: AiRunState) => {
      if (state.mainStage === 'main_context_enrich') return 'main_context_enrich_node'
      if (state.mainStage === 'main_plan') return 'main_plan_node'
      if (state.mainStage === 'main_dispatch') return 'main_dispatch_node'
      return 'main_finalize_node'
    })
    .addEdge('main_context_enrich_node', 'main_intent_node')
    .addEdge('main_plan_node', 'main_dispatch_node')
    .addConditionalEdges('main_dispatch_node', (state: AiRunState) => {
      if (state.mainStage === 'main_dispatch' && state.status === 'running')
        return 'main_dispatch_node'
      return 'main_finalize_node'
    })
    .addEdge('main_finalize_node', END)
    .compile()
}
