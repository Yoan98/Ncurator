import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, AiRunState, HumanTaskRunner } from '../types'
import { createHumanGraphRunner } from './humanGraph'
import { createIntentNode } from '../node/main/intentNode'
import { createContextEnrichNode } from '../node/main/contextEnrichNode'
import { createDirectHumanExecNode } from '../node/main/directHumanExecNode'
import { createPlanNode } from '../node/main/planNode'
import { createPlanExecNode } from '../node/main/planExecNode'
import { createSynthesisHumanNode } from '../node/main/synthesisHumanNode'
import { createCompleteNode } from '../node/main/completeNode'
import { DEFAULT_MAX_CONTEXT_ROUNDS } from '../node/main/helpers'
import { createMainRunStateSchema } from '../state/stateSchemas'

export const buildMainGraph = (input: {
  ctx: AiRunContext
  maxContextRounds?: number
  runHumanTask?: HumanTaskRunner
}) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))
  const State = createMainRunStateSchema()
  const runHumanTask = input.runHumanTask || createHumanGraphRunner({ ctx })

  const intentNode = createIntentNode({ ctx, maxContextRounds })
  const contextEnrichNode = createContextEnrichNode({ ctx, runHumanTask })
  const directHumanExecNode = createDirectHumanExecNode({ ctx, runHumanTask })
  const planNode = createPlanNode({ ctx })
  const planExecNode = createPlanExecNode({ ctx, runHumanTask })
  const synthesisHumanNode = createSynthesisHumanNode({ ctx, runHumanTask })
  const completeNode = createCompleteNode()

  return new StateGraph(State)
    .addNode('main_intent_node', (state: AiRunState) => intentNode(state))
    .addNode('main_context_human_node', (state: AiRunState) => contextEnrichNode(state))
    .addNode('main_direct_human_exec_node', (state: AiRunState) => directHumanExecNode(state))
    .addNode('main_plan_node', (state: AiRunState) => planNode(state))
    .addNode('main_plan_exec_node', (state: AiRunState) => planExecNode(state))
    .addNode('main_synthesis_human_node', (state: AiRunState) => synthesisHumanNode(state))
    .addNode('main_complete_node', (state: AiRunState) => completeNode(state))
    .addEdge(START, 'main_intent_node')
    .addConditionalEdges('main_intent_node', (state: AiRunState) => {
      if (state.mainStage === 'main_context_human') return 'main_context_human_node'
      if (state.mainStage === 'main_direct_human_exec') return 'main_direct_human_exec_node'
      if (state.mainStage === 'main_plan') return 'main_plan_node'
      if (state.mainStage === 'main_plan_exec') return 'main_plan_exec_node'
      if (state.mainStage === 'main_synthesis_human') return 'main_synthesis_human_node'
      return 'main_complete_node'
    })
    .addEdge('main_context_human_node', 'main_intent_node')
    .addEdge('main_direct_human_exec_node', 'main_complete_node')
    .addConditionalEdges('main_plan_node', (state: AiRunState) => {
      if (state.mainStage === 'main_plan_exec' && state.status === 'running')
        return 'main_plan_exec_node'
      return 'main_complete_node'
    })
    .addConditionalEdges('main_plan_exec_node', (state: AiRunState) => {
      if (state.mainStage === 'main_plan_exec' && state.status === 'running')
        return 'main_plan_exec_node'
      return 'main_synthesis_human_node'
    })
    .addEdge('main_synthesis_human_node', 'main_complete_node')
    .addEdge('main_complete_node', END)
    .compile()
}
