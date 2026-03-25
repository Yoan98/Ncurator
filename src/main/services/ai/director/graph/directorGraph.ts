import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { createHumanGraphRunner } from '../../human/graph/humanGraph'
import { createIntentNode } from '../node/intentNode'
import { createPlanNode } from '../node/planNode'
import { createPlanExecNode } from '../node/planExecNode'
import { createCompleteNode } from '../node/completeNode'
import { DEFAULT_MAX_CONTEXT_ROUNDS } from '../node/helpers'
import {
  createContextEnrichNode,
  createDirectHumanExecNode,
  createSynthesisHumanNode
} from '../node/humanSubtasks'
import { createDirectorRunStateSchema } from '../state/schema'

export const buildDirectorGraph = (input: {
  ctx: AiRunContext
  maxContextRounds?: number
  runHumanTask?: HumanTaskRunner
}) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))
  const State = createDirectorRunStateSchema()
  const runHumanTask = input.runHumanTask || createHumanGraphRunner({ ctx })

  const intentNode = createIntentNode({ ctx, maxContextRounds })
  const contextEnrichNode = createContextEnrichNode({ ctx, runHumanTask })
  const directHumanExecNode = createDirectHumanExecNode({ ctx, runHumanTask })
  const planNode = createPlanNode({ ctx })
  const planExecNode = createPlanExecNode({ ctx, runHumanTask })
  const synthesisHumanNode = createSynthesisHumanNode({ ctx, runHumanTask })
  const completeNode = createCompleteNode()

  return new StateGraph(State)
    .addNode('director_intent_node', (state: AiRunState) => intentNode(state))
    .addNode('director_context_human_node', (state: AiRunState) => contextEnrichNode(state))
    .addNode('director_direct_human_exec_node', (state: AiRunState) => directHumanExecNode(state))
    .addNode('director_plan_node', (state: AiRunState) => planNode(state))
    .addNode('director_plan_exec_node', (state: AiRunState) => planExecNode(state))
    .addNode('director_synthesis_human_node', (state: AiRunState) => synthesisHumanNode(state))
    .addNode('director_complete_node', (state: AiRunState) => completeNode(state))
    .addEdge(START, 'director_intent_node')
    .addConditionalEdges('director_intent_node', (state: AiRunState) => {
      if (state.directorStage === 'director_context_human') return 'director_context_human_node'
      if (state.directorStage === 'director_direct_human_exec') return 'director_direct_human_exec_node'
      if (state.directorStage === 'director_plan') return 'director_plan_node'
      if (state.directorStage === 'director_plan_exec') return 'director_plan_exec_node'
      if (state.directorStage === 'director_synthesis_human') return 'director_synthesis_human_node'
      return 'director_complete_node'
    })
    .addEdge('director_context_human_node', 'director_intent_node')
    .addEdge('director_direct_human_exec_node', 'director_complete_node')
    .addConditionalEdges('director_plan_node', (state: AiRunState) => {
      if (state.directorStage === 'director_plan_exec' && state.status === 'running')
        return 'director_plan_exec_node'
      return 'director_complete_node'
    })
    .addConditionalEdges('director_plan_exec_node', (state: AiRunState) => {
      if (state.directorStage === 'director_plan_exec' && state.status === 'running')
        return 'director_plan_exec_node'
      return 'director_synthesis_human_node'
    })
    .addEdge('director_synthesis_human_node', 'director_complete_node')
    .addEdge('director_complete_node', END)
    .compile()
}
