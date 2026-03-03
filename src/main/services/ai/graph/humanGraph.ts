import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { JsonObject, JsonValue, HumanTaskInput, HumanTaskOutput } from '../../../../shared/types'
import type { AiRunContext } from '../types'
import { createHumanInitNode } from '../node/human/initNode'
import { createHumanBrainNode } from '../node/human/brainNode'
import { createHumanToolExecNode } from '../node/human/toolExecNode'
import { createHumanSlotCommitNode } from '../node/human/slotCommitNode'
import { createHumanExitNode } from '../node/human/exitNode'
import type { HumanRunState } from '../node/human/types'

const createHumanStateSchema = () => {
  // Human subgraph 的状态仅服务当前 task，结束后由 Main 回收结果。
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
  const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
    runId: z.string(),
    sessionId: z.string(),
    taskId: z.string(),
    mode: z.enum(['context', 'dispatch']),
    title: z.string(),
    objective: z.string(),
    kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional(),
    selectedDocumentIds: z.array(z.string()).optional(),
    workspace: z
      .object({
        workspaceId: z.string(),
        rootPath: z.string(),
        policyProfile: z.string().optional()
      })
      .optional(),
    slotState: jsonObjectSchema,
    slotArtifacts: z.record(z.string(), jsonObjectSchema).optional()
  })

  return new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    input: humanTaskInputSchema,
    phase: z.enum(['brain', 'tool_exec', 'slot_commit', 'exit']).default('brain'),
    terminalState: z.enum(['running', 'completed', 'blocked']).default('running'),
    steps: z.number().default(0),
    maxSteps: z.number().default(6),
    messages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    activeTools: z
      .array(z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    capabilityByTool: z
      .record(z.string(), z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']))
      .default(() => ({})),
    lastAiMessage: z
      .custom<AIMessage>((value) => typeof value === 'object' && value !== null)
      .optional(),
    lastToolMessages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    lastToolName: z.string().optional(),
    lastToolArgs: jsonObjectSchema.optional(),
    consume: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    produce: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    expect: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    pendingPayload: jsonObjectSchema.optional(),
    slotState: z.record(z.string(), jsonValueSchema).default(() => ({})),
    slotArtifacts: z.record(z.string(), jsonObjectSchema).default(() => ({})),
    slotDelta: jsonObjectSchema.default(() => ({})),
    summary: z.string().default(''),
    resultCode: z
      .enum([
        'ok',
        'failed',
        'workspace_required',
        'approval_denied',
        'bounded_loop_error',
        'invalid_input'
      ])
      .default('failed'),
    resultData: jsonObjectSchema.optional()
  })
}

export const createHumanGraphRunner = (input: {
  ctx: AiRunContext
  maxSteps?: number
}) => {
  const { ctx } = input
  const maxSteps = Math.max(1, Number(input.maxSteps || 6))
  const State = createHumanStateSchema()

  const initNode = createHumanInitNode()
  const brainNode = createHumanBrainNode({ ctx })
  const toolExecNode = createHumanToolExecNode({ ctx })
  const slotCommitNode = createHumanSlotCommitNode({ ctx })
  const exitNode = createHumanExitNode()

  const graph = new StateGraph(State)
    .addNode('human_init_node', (state: HumanRunState) => initNode(state))
    .addNode('human_brain_node', (state: HumanRunState) => brainNode(state))
    .addNode('human_tool_exec_node', (state: HumanRunState) => toolExecNode(state))
    .addNode('human_slot_commit_node', (state: HumanRunState) => slotCommitNode(state))
    .addNode('human_exit_node', (state: HumanRunState) => exitNode(state))
    .addEdge(START, 'human_init_node')
    .addEdge('human_init_node', 'human_brain_node')
    // brain 只能选择：继续 tool 执行，或直接终态退出。
    .addConditionalEdges('human_brain_node', (state: HumanRunState) => {
      if (state.phase === 'tool_exec') return 'human_tool_exec_node'
      return 'human_exit_node'
    })
    // tool_exec 成功后进入 slot_commit，失败/终态直接退出。
    .addConditionalEdges('human_tool_exec_node', (state: HumanRunState) => {
      if (state.phase === 'slot_commit') return 'human_slot_commit_node'
      if (state.phase === 'brain') return 'human_brain_node'
      return 'human_exit_node'
    })
    // slot_commit 是每步写状态的唯一入口，提交后回到 brain。
    .addConditionalEdges('human_slot_commit_node', (state: HumanRunState) => {
      if (state.phase === 'brain') return 'human_brain_node'
      return 'human_exit_node'
    })
    .addEdge('human_exit_node', END)
    .compile()

  return async (taskInput: HumanTaskInput): Promise<HumanTaskOutput> => {
    const initialSlotState = taskInput.slotState || {}
    const initialArtifacts = taskInput.slotArtifacts || {}

    const output = (await graph.invoke({
      runId: taskInput.runId,
      sessionId: taskInput.sessionId,
      input: taskInput,
      phase: 'brain',
      terminalState: 'running',
      steps: 0,
      maxSteps,
      messages: [],
      activeTools: [],
      capabilityByTool: {},
      lastToolMessages: [],
      consume: [],
      produce: [],
      expect: [],
      slotState: initialSlotState,
      slotArtifacts: initialArtifacts,
      slotDelta: {},
      summary: '',
      resultCode: 'failed'
    } as HumanRunState)) as HumanRunState

    const terminalState = output.terminalState === 'completed' ? 'completed' : 'blocked'
    return {
      taskId: taskInput.taskId,
      terminalState,
      steps: output.steps,
      summary: output.summary,
      resultCode: output.resultCode,
      resultData: output.resultData,
      slotDelta: output.slotDelta,
      slotState: output.slotState as JsonObject,
      slotArtifacts: output.slotArtifacts
    }
  }
}
