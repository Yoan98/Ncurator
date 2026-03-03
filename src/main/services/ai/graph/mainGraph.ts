import { END, START, StateGraph } from '@langchain/langgraph'
import type { AiRunContext, AiRunState } from '../types'
import { createHumanGraphRunner } from './humanGraph'
import { createMainContextGateNode } from '../node/main/contextGateNode'
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

  const contextGateNode = createMainContextGateNode({ ctx, maxContextRounds })
  const contextDispatchNode = createMainContextDispatchNode({ ctx, runHumanTask })
  const planNode = createMainPlanNode({ ctx })
  const dispatchNode = createMainDispatchNode({ ctx, runHumanTask })
  const finalizeNode = createMainFinalizeNode({ ctx })

  return (
    new StateGraph(State)
      .addNode('main_context_gate_node', (state: AiRunState) => contextGateNode(state))
      .addNode('main_context_dispatch_node', (state: AiRunState) => contextDispatchNode(state))
      .addNode('main_plan_node', (state: AiRunState) => planNode(state))
      .addNode('main_dispatch_node', (state: AiRunState) => dispatchNode(state))
      .addNode('main_finalize_node', (state: AiRunState) => finalizeNode(state))
      .addEdge(START, 'main_context_gate_node')
      // 单一路由源：由 mainStage 决定下一跳，避免节点之间的隐式耦合。
      .addConditionalEdges('main_context_gate_node', (state: AiRunState) => {
        if (state.mainStage === 'main_context_dispatch') return 'main_context_dispatch_node'
        if (state.mainStage === 'main_plan') return 'main_plan_node'
        if (state.mainStage === 'main_dispatch') return 'main_dispatch_node'
        return 'main_finalize_node'
      })
      .addEdge('main_context_dispatch_node', 'main_context_gate_node')
      .addEdge('main_plan_node', 'main_dispatch_node')
      // dispatch 支持串行自循环，直到无 pending 或进入失败收敛。
      .addConditionalEdges('main_dispatch_node', (state: AiRunState) => {
        if (state.mainStage === 'main_dispatch' && state.status === 'running')
          return 'main_dispatch_node'
        return 'main_finalize_node'
      })
      .addEdge('main_finalize_node', END)
      .compile()
  )
}
