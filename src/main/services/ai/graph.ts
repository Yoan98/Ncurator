import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { AiPlanTask, AiRunContext, AiRunState, AiTaskKind } from './types'
import { createChatModel } from '../llm/chatModel'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AiTaskToolInput, JsonObject, JsonValue } from '../../../shared/types'
import { toString } from '../../utils/decoder'
import { executeDocxNode } from './node/capability/docx/docxNode'
import { executeLocalKbRetrievalNode } from './node/capability/local_kb_retrieval/retrievalNode'
import { executeTerminalExecNode } from './node/capability/terminal_exec/terminalExecNode'
import { getMessageText, isJsonObject, markTaskFailed } from '../../utils/aiCapabilityUtils'
import type { CapabilityExecutor } from '../../utils/aiCapabilityUtils'

const CAPABILITY_KINDS: AiTaskKind[] = ['local_kb_retrieval', 'terminal_exec', 'docx']

type PlannerTaskEnvelope = { tasks?: JsonValue }
type PlannerTaskRaw = {
  id?: string
  title?: string
  kind?: string
  input?: string
  objective?: string
  preferredCwd?: string
  sourcePath?: string
  outputPath?: string
}

const toPlannedTask = (value: PlannerTaskRaw, index: number): AiPlanTask => {
  const kind = normalizePlannedKind(value.kind)
  const normalizedInput = value.input == null ? undefined : toString(value.input).trim()
  const objective =
    normalizedInput || toString(value.objective || value.title || '').trim() || undefined
  const toolInput =
    objective && kind === 'terminal_exec'
      ? {
          kind: 'terminal_exec' as const,
          objective,
          preferredCwd:
            value.preferredCwd == null
              ? undefined
              : toString(value.preferredCwd).trim() || undefined
        }
      : objective && kind === 'docx'
        ? {
            kind: 'docx' as const,
            objective,
            sourcePath:
              value.sourcePath == null ? undefined : toString(value.sourcePath).trim() || undefined,
            outputPath:
              value.outputPath == null ? undefined : toString(value.outputPath).trim() || undefined
          }
        : objective && kind === 'local_kb_retrieval'
          ? {
              kind: 'local_kb_retrieval' as const,
              objective
            }
          : undefined

  return {
    id: toString(value.id || `task-${index + 1}`),
    title: toString(value.title || 'Task'),
    kind,
    input: normalizedInput,
    toolInput,
    status: 'pending',
    attempts: 0
  }
}

const isKnownCapabilityKind = (kind: string): kind is AiTaskKind => {
  return CAPABILITY_KINDS.includes(kind as AiTaskKind)
}

const normalizePlannedKind = (kind?: string): string => {
  const value = String(kind || '').trim()
  if (!value) return 'local_kb_retrieval'
  if (isKnownCapabilityKind(value)) return value
  return value
}

const inferHeuristicKind = (input: string): AiTaskKind => {
  const text = String(input || '')
  if (/\b(cmd|bash|shell|terminal|command|run)\b/i.test(text) || /终端|命令|脚本|执行/.test(text)) {
    return 'terminal_exec'
  }
  if (/\b(docx|word)\b/i.test(text) || /docx|word|文档/.test(text)) {
    return 'docx'
  }
  return 'local_kb_retrieval'
}

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
  // Keep state schema permissive enough for graph transitions while maintaining task shape.
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
    error: z.string().optional(),
    outputText: z.string().optional()
  })

const pickNextTask = (plan: AiPlanTask[]) => {
  for (const t of plan) {
    if (t.status === 'running') return t
  }
  for (const t of plan) {
    if (t.status === 'pending') return t
  }
  return null
}

const ensurePlan = async (ctx: AiRunContext, state: AiRunState): Promise<AiPlanTask[]> => {
  if (Array.isArray(state.plan) && state.plan.length > 0) return state.plan

  const heuristicKind = inferHeuristicKind(state.input)
  const heuristic: AiPlanTask[] = [
    {
      id: 'task-1',
      title: '分析并完成请求',
      kind: heuristicKind,
      input: String(state.input || '').trim() || undefined,
      toolInput: {
        kind: heuristicKind,
        objective: String(state.input || '').trim()
      },
      status: 'pending',
      attempts: 0
    }
  ]

  try {
    const history = await ctx.loadHistory()
    const json = await ctx.chatJson<PlannerTaskEnvelope>({
      system: [
        'You are a planning host for a desktop AI runtime.',
        'Output JSON only as: {"tasks":[{"id":"...","title":"...","kind":"local_kb_retrieval"|"terminal_exec"|"docx","input":"task objective text","objective":"optional richer objective","sourcePath":"optional .docx source","outputPath":"optional .docx output"}]}.',
        'For terminal/docx tasks, input should be natural-language objective text, not raw shell commands.',
        'Return tasks: [] only when no retrieval or execution is needed.'
      ].join(' '),
      user: `User message:\n${state.input}\n\nSession summary:\n${history.sessionSummaryText}\n\nRecent turns:\n${history.recentTurnsText}`,
      temperature: 0.1
    })

    const rawTasks = Array.isArray(json.tasks) ? json.tasks : []
    if (rawTasks.length === 0) return heuristic

    const mapped: AiPlanTask[] = rawTasks
      .filter(isJsonObject)
      .map((task, i) => toPlannedTask(task as PlannerTaskRaw, i))
      .filter((t) => Boolean(t.id && t.title))

    return mapped
  } catch (e) {
    void e
    return heuristic
  }
}

const buildHostFinalAnswer = async (ctx: AiRunContext, state: AiRunState): Promise<string> => {
  ctx.checkCancelled()
  const planText = (state.plan || [])
    .map((t) => `${t.id} | ${t.kind} | ${t.status}${t.error ? ` | ${t.error}` : ''}`)
    .join('\n')

  try {
    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.2 })
    const res = await model.invoke([
      new SystemMessage(
        '你是桌面 AI 运行时中的 host。请基于用户输入和执行结果，输出简洁、直接、可执行的最终回复。'
      ),
      new HumanMessage(
        `用户输入:\n${state.input}\n\n计划执行情况:\n${planText || '无计划任务'}\n\n已知结论:\n${String(state.outputText || '').trim() || '无'}\n\n请直接给最终答复。`
      )
    ])
    const text = getMessageText(res.content).trim()
    if (text) return text
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('cancel')) throw e
  }

  return String(state.outputText || '').trim() || '已完成。'
}

const hostNode = async (ctx: AiRunContext, state: AiRunState): Promise<Partial<AiRunState>> => {
  ctx.checkCancelled()

  const plan = await ensurePlan(ctx, state)
  if (!state.plan.length && plan.length) {
    ctx.sendEvent({ type: 'plan_created', runId: state.runId, plan })
  }

  const failed = plan.find((t) => t.status === 'failed')
  if (failed) {
    return {
      plan,
      activeTaskId: undefined,
      status: 'failed',
      error: failed.error || state.error || 'failed'
    }
  }

  const next = pickNextTask(plan)
  if (!next) {
    const outputText = await buildHostFinalAnswer(ctx, { ...state, plan })
    return {
      plan,
      activeTaskId: undefined,
      status: 'completed',
      outputText
    }
  }

  if (next.status === 'pending') {
    const updated: AiPlanTask[] = plan.map((t) =>
      t.id === next.id ? { ...t, status: 'running' as const } : t
    )
    ctx.sendEvent({ type: 'task_started', runId: state.runId, taskId: next.id })
    return { plan: updated, activeTaskId: next.id, status: 'running' }
  }

  return { plan, activeTaskId: next.id, status: 'running' }
}

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

  const task = (state.plan || []).find((t) => t.id === taskId)
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

  return new StateGraph(State)
    .addNode('host', (s: AiRunState) => hostNode(ctx, s))
    .addNode('capability', (s: AiRunState) => capabilityNode(ctx, s))
    .addEdge(START, 'host')
    .addConditionalEdges('host', (s: AiRunState) => {
      if (s.status === 'failed' || s.status === 'completed' || s.status === 'cancelled') {
        return END
      }
      const next = pickNextTask(s.plan || [])
      if (!next) return END
      return 'capability'
    })
    .addEdge('capability', 'host')
    .compile()
}
