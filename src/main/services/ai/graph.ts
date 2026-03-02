import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { AiRunContext, AiRunState, AiTaskKind } from './types'
import type { AiTaskToolInput, JsonObject, JsonValue } from '../../../shared/types'
import { executeDocxNode } from './node/capability/docx/docxNode'
import { executeLocalKbRetrievalNode } from './node/capability/local_kb_retrieval/retrievalNode'
import { executeTerminalExecNode } from './node/capability/terminal_exec/terminalExecNode'
import { createHostNode } from './node/host/hostNode'
import { markTaskFailed } from '../../utils/aiCapabilityUtils'
import type { CapabilityExecutor } from '../../utils/aiCapabilityUtils'

const taskToolInputSchema: z.ZodType<AiTaskToolInput> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local_kb_retrieval'),
    objective: z.string()
  }),
  z.object({
    kind: z.literal('terminal_exec'),
    objective: z.string(),
    preferredCwd: z.string().optional()
  }),
  z.object({
    kind: z.literal('docx'),
    objective: z.string(),
    sourcePath: z.string().optional(),
    outputPath: z.string().optional()
  })
])

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

const createAiRunStateSchema = () =>
  new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    input: z.string(),
    plan: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          kind: z.string(),
          input: z.string().optional(),
          toolInput: taskToolInputSchema.optional(),
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
    activeTaskId: z.string().optional(),
    hostLoopStartedAt: z.number().default(() => Date.now()),
    hostDecisionRounds: z.number().default(0),
    contextEnrichmentRounds: z.number().default(0),
    contextEvidence: z.array(z.string()).default(() => []),
    lastHostAction: z.enum(['retrieve_context', 'create_plan', 'final_answer']).optional(),
    error: z.string().optional(),
    outputText: z.string().optional()
  })

const capabilityRegistry = new Map<string, CapabilityExecutor>()

const registerCapability = (kind: string, executor: CapabilityExecutor) => {
  capabilityRegistry.set(String(kind || '').trim(), executor)
}

registerCapability('local_kb_retrieval', executeLocalKbRetrievalNode)
registerCapability('terminal_exec', executeTerminalExecNode)
registerCapability('docx', executeDocxNode)

const capabilityNode = async (
  ctx: AiRunContext,
  state: AiRunState
): Promise<Partial<AiRunState>> => {
  ctx.checkCancelled()

  const taskId = state.activeTaskId
  if (!taskId) return {}

  const task = (state.plan || []).find((item) => item.id === taskId)
  if (!task) {
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'failed',
      error: `task not found: ${taskId}`
    }
  }

  const rawKind = String(task.kind || '').trim()
  const executor = capabilityRegistry.get(rawKind)
  if (!executor) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      `unsupported capability kind: ${rawKind || '(empty)'}`
    )
  }

  return executor(ctx, state, task)
}

export const buildAiRunGraph = (ctx: AiRunContext) => {
  const State = createAiRunStateSchema()
  const hostNode = createHostNode({ ctx, capabilityRegistry })

  return new StateGraph(State)
    .addNode('host', (state: AiRunState) => hostNode(state))
    .addNode('capability', (state: AiRunState) => capabilityNode(ctx, state))
    .addEdge(START, 'host')
    .addConditionalEdges('host', (state: AiRunState) => {
      if (state.status === 'failed' || state.status === 'completed' || state.status === 'cancelled') {
        return END
      }
      if (state.activeTaskId) return 'capability'
      return 'host'
    })
    .addEdge('capability', 'host')
    .compile()
}

export const getRegisteredCapabilityKinds = (): AiTaskKind[] => {
  return Array.from(capabilityRegistry.keys()).filter((kind): kind is AiTaskKind => {
    return kind === 'local_kb_retrieval' || kind === 'terminal_exec' || kind === 'docx'
  })
}
