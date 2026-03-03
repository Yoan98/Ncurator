import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import type { AiRunContext, AiRunState } from '../types'
import { createHumanGraphRunner } from './humanGraph'
import { createMainContextGateNode } from '../node/main/contextGateNode'
import { createMainContextDispatchNode } from '../node/main/contextDispatchNode'
import { createMainPlanNode } from '../node/main/planNode'
import { createMainDispatchNode } from '../node/main/dispatchNode'
import { createMainFinalizeNode } from '../node/main/finalizeNode'
import { DEFAULT_MAX_CONTEXT_ROUNDS } from '../node/main/helpers'

const createMainStateSchema = () => {
  // Main graph 的状态契约：所有节点只通过该对象读写共享状态。
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

  return new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    input: z.string(),
    mainStage: z
      .enum([
        'main_context_gate',
        'main_context_dispatch',
        'main_plan',
        'main_dispatch',
        'main_finalize'
      ])
      .default('main_context_gate'),
    contextRounds: z.number().default(0),
    contextDecision: z.enum(['need_context', 'to_plan', 'direct_finalize']).optional(),
    contextTaskObjective: z.string().optional(),
    contextEvidence: z.array(z.string()).default(() => []),
    directAnswerDraft: z.string().optional(),
    plan: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          objective: z.string(),
          kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional(),
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          attempts: z.number(),
          error: z.string().optional(),
          resultCode: z
            .enum([
              'ok',
              'failed',
              'workspace_required',
              'approval_denied',
              'bounded_loop_error',
              'invalid_input'
            ])
            .optional(),
          resultMessage: z.string().optional(),
          resultData: jsonObjectSchema.optional()
        })
      )
      .default(() => []),
    dispatchCursor: z.number().default(0),
    taskSlots: z.record(z.string(), z.record(z.string(), jsonValueSchema)).default(() => ({})),
    slotArtifacts: z.record(z.string(), jsonObjectSchema).default(() => ({})),
    humanStepIndex: z.number().default(0),
    error: z.string().optional(),
    outputText: z.string().optional()
  })
}

export const buildMainGraph = (input: { ctx: AiRunContext; maxContextRounds?: number }) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))
  const State = createMainStateSchema()
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
