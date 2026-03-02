import { randomUUID } from 'node:crypto'
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { z } from 'zod/v4'
import type { AiPlanTask, AiRunContext, AiRunState, AiTaskKind } from './types'
import { createChatModel } from '../llm/chatModel'
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AiTaskResultCode, AiTaskToolInput, JsonObject, JsonValue } from '../../../shared/types'
import { toString } from '../../utils/decoder'
import { buildRetrievalTools } from './nodes/local_kb_retrieval/retrievalTools'
import { buildTerminalCapabilityTools } from './nodes/terminal_exec/terminalTools'
import { buildDocxCapabilityTools } from './nodes/docx/docxTools'
import { runBoundedLoop } from '../../utils/boundedLoop'

const CAPABILITY_KINDS: AiTaskKind[] = ['local_kb_retrieval', 'terminal_exec', 'docx']
const MAX_RETRIEVAL_DISPATCH_STEPS = 3
const MAX_TOOL_ROUNDS_PER_DISPATCH = 3

const MAX_TERMINAL_STEPS = 6
const TERMINAL_LOOP_TIMEOUT_MS = 60000
const TERMINAL_TIMEOUT_MS = 15000
const TERMINAL_MAX_OUTPUT_CHARS = 8000
const TERMINAL_SAFE_PREVIEW_CHARS = 600
const MAX_DOCX_STEPS = 8
const DOCX_LOOP_TIMEOUT_MS = 90000
const DOCX_SAFE_PREVIEW_CHARS = 1400

type MessageContent = BaseMessage['content'] | undefined
type PlannerTaskEnvelope = { tasks?: JsonValue }
type ToolNodeInvokeResult = { messages?: BaseMessage[] }
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
type PlannerTaskResult = { satisfied?: boolean; note?: string }

const getToolNodeMessages = (value: ToolNodeInvokeResult): BaseMessage[] => {
  const raw = value.messages
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is BaseMessage => item instanceof BaseMessage)
}

const toPlannedTask = (value: PlannerTaskRaw, index: number): AiPlanTask => {
  const kind = normalizePlannedKind(value.kind)
  const normalizedInput = value.input == null ? undefined : toString(value.input).trim()
  const objective = normalizedInput || toString(value.objective || value.title || '').trim() || undefined
  const toolInput =
    objective && kind === 'terminal_exec'
      ? {
          kind: 'terminal_exec' as const,
          objective,
          preferredCwd:
            value.preferredCwd == null ? undefined : toString(value.preferredCwd).trim() || undefined
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

const parseJsonObject = <T extends JsonObject>(text: string): T => {
  const trimmed = String(text || '').trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    void err
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1)
    return JSON.parse(slice) as T
  }
  throw new Error('无法解析 JSON 输出')
}

const getMessageText = (content: MessageContent): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  return content
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk
      if ('text' in chunk && typeof chunk.text === 'string') return chunk.text
      return ''
    })
    .join('\n')
}

const getToolCalls = (message: AIMessage) => {
  return Array.isArray(message.tool_calls) ? message.tool_calls : []
}

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
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

type CapabilityExecutor = (
  ctx: AiRunContext,
  state: AiRunState,
  task: AiPlanTask
) => Promise<Partial<AiRunState>>

const emitActivity = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}) => {
  input.ctx.sendEvent({
    type: 'activity',
    runId: input.runId,
    taskId: input.taskId,
    activityId: randomUUID(),
    actionType: input.actionType,
    status: input.status,
    summary: input.summary,
    createdAt: Date.now()
  })
}

const markTaskFailed = (
  ctx: AiRunContext,
  state: AiRunState,
  taskId: string,
  error: string,
  code: AiTaskResultCode = 'failed',
  data?: JsonObject
): Partial<AiRunState> => {
  const plan = (state.plan || []).map((t) =>
    t.id === taskId
      ? {
          ...t,
          attempts: Number(t.attempts || 0) + 1,
          status: 'failed' as const,
          error,
          resultCode: code,
          resultMessage: error,
          resultData: data
        }
      : t
  )
  ctx.sendEvent({ type: 'task_failed', runId: state.runId, taskId, error })
  ctx.sendEvent({
    type: 'task_result',
    runId: state.runId,
    taskId,
    code,
    message: error,
    data
  })
  emitActivity({
    ctx,
    runId: state.runId,
    taskId,
    actionType: 'task',
    status: 'failed',
    summary: error
  })
  return {
    plan,
    activeTaskId: undefined,
    error,
    outputText: error
  }
}

const completeTask = (input: {
  ctx: AiRunContext
  state: AiRunState
  task: AiPlanTask
  code?: AiTaskResultCode
  message?: string
  data?: JsonObject
  outputText?: string
}): Partial<AiRunState> => {
  const code = input.code || 'ok'
  const plan = (input.state.plan || []).map((taskItem) =>
    taskItem.id === input.task.id
      ? {
          ...taskItem,
          attempts: Number(taskItem.attempts || 0) + 1,
          status: 'completed' as const,
          error: undefined,
          resultCode: code,
          resultMessage: input.message,
          resultData: input.data
        }
      : taskItem
  )
  input.ctx.sendEvent({ type: 'task_completed', runId: input.state.runId, taskId: input.task.id })
  input.ctx.sendEvent({
    type: 'task_result',
    runId: input.state.runId,
    taskId: input.task.id,
    code,
    message: input.message,
    data: input.data
  })
  return {
    plan,
    activeTaskId: undefined,
    outputText: input.outputText || input.message || input.state.outputText
  }
}

const resolveTaskObjective = (state: AiRunState, task: AiPlanTask): string => {
  if (task.toolInput?.kind === 'terminal_exec' || task.toolInput?.kind === 'docx') {
    return String(task.toolInput.objective || '').trim()
  }
  if (task.toolInput?.kind === 'local_kb_retrieval') {
    return String(task.toolInput.objective || '').trim()
  }
  return String(task.input || task.title || state.input || '').trim()
}

const executeLocalKbRetrieval: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const tools = buildRetrievalTools({ ctx, runId: state.runId, taskId: task.id })
  const toolNode = new ToolNode(tools)
  const cfg = await ctx.getModelConfig()
  const model = createChatModel(cfg, { temperature: 0.2 }).bindTools(tools)

  const system = [
    'You are the `local_kb_retrieval` capability.',
    'Use retrieval tools to gather minimal evidence for this task.',
    'If evidence is enough, output JSON only as {"satisfied": true, "note": "short"}.',
    'If not enough, output JSON only as {"satisfied": false, "note": "short"}.',
    'Do not output any extra keys.'
  ].join('\n')
  const scopedDocumentIdsText =
    Array.isArray(ctx.selectedDocumentIds) && ctx.selectedDocumentIds.length > 0
      ? ctx.selectedDocumentIds.join(', ')
      : '(none)'
  const user = `User input:\n${state.input}\n\nTask:\n${String(task.title || task.id)}\n\nCurrent attempt: ${Number(task.attempts || 0) + 1}/${MAX_RETRIEVAL_DISPATCH_STEPS}\n\nScoped document ids from run context:\n${scopedDocumentIdsText}\n\nIf scope exists, keep retrieval within that scope by default.`

  let satisfied = false
  let note = ''
  let lastAi: AIMessage | null = null
  const messages: BaseMessage[] = [
    new SystemMessage(system),
    new HumanMessage(user)
  ]

  for (let i = 0; i < MAX_TOOL_ROUNDS_PER_DISPATCH; i += 1) {
    ctx.checkCancelled()
    const ai = (await model.invoke(messages)) as AIMessage
    lastAi = ai
    messages.push(ai)

    const toolCalls = getToolCalls(ai)
    if (toolCalls.length > 0) {
      const out = (await toolNode.invoke({ messages: [ai] })) as ToolNodeInvokeResult
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)
      continue
    }

    const content = getMessageText(ai.content)
    try {
      const json = parseJsonObject<PlannerTaskResult>(content)
      satisfied = Boolean(json?.satisfied)
      note = String(json?.note || '')
    } catch (e) {
      void e
      satisfied = false
      note = ''
    }
    break
  }

  const attempts = Number(task.attempts || 0) + 1
  if (satisfied) {
    return completeTask({
      ctx,
      state,
      task,
      code: 'ok',
      message: note || undefined,
      outputText: note || state.outputText
    })
  }

  if (attempts >= MAX_RETRIEVAL_DISPATCH_STEPS) {
    const err = note || 'local_kb_retrieval not satisfied'
    return markTaskFailed(ctx, state, task.id, err)
  }

  const plan = (state.plan || []).map((t) =>
    t.id === task.id
      ? {
          ...t,
          attempts,
          status: 'running' as const,
          error: undefined,
          resultCode: undefined,
          resultMessage: undefined,
          resultData: undefined
        }
      : t
  )

  return {
    plan,
    activeTaskId: undefined,
    outputText: note || getMessageText(lastAi?.content) || state.outputText
  }
}

const executeTerminalExec: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const objective = resolveTaskObjective(state, task)
  if (!objective) {
    return markTaskFailed(ctx, state, task.id, 'terminal_exec requires objective input', 'invalid_input')
  }

  const workspaceId = String(ctx.workspace?.workspaceId || '').trim()
  const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
  if (!workspaceId || !workspaceRootPath) {
    ctx.sendEvent({
      type: 'workspace_required',
      runId: state.runId,
      taskId: task.id,
      reason: 'terminal_exec requires workspace binding before execution',
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now()
    })
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'workspace is required for terminal_exec',
      'workspace_required'
    )
  }

  const cfg = await ctx.getModelConfig()
  const terminal = buildTerminalCapabilityTools({
    ctx,
    runId: state.runId,
    taskId: task.id,
    workspaceRootPath,
    timeoutMs: TERMINAL_TIMEOUT_MS,
    maxOutputChars: TERMINAL_MAX_OUTPUT_CHARS,
    safePreviewChars: TERMINAL_SAFE_PREVIEW_CHARS,
    emitActivity: (activity) => {
      emitActivity({
        ctx,
        runId: state.runId,
        taskId: task.id,
        actionType: activity.actionType,
        status: activity.status,
        summary: activity.summary
      })
    }
  })
  const toolNode = new ToolNode(terminal.tools)
  const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(terminal.tools)
  const messages: BaseMessage[] = [
    new SystemMessage(
      [
        'You are the `terminal_exec` capability.',
        'User provides natural-language objective. Do not assume raw shell command input.',
        'Only execute shell commands through tool `terminal_run_command`.',
        'Never claim completion in plain text. Finish only by calling `terminal_finish`.',
        'When commands write files, always include `expectedArtifacts` in `terminal_run_command`.',
        'If a command is unsafe or blocked, adapt strategy and then call `terminal_finish` with success=false when objective cannot continue.'
      ].join('\n')
    ),
    new HumanMessage(
      `Objective:\n${objective}\n\nWorkspace root:\n${workspaceRootPath}\n\nTask title:\n${task.title}\n\nLoop limit:\n${MAX_TERMINAL_STEPS} tool rounds, ${TERMINAL_LOOP_TIMEOUT_MS}ms timeout.`
    )
  ]

  const loopResult = await runBoundedLoop<{
    success: boolean
    code?: AiTaskResultCode
    message: string
    data?: JsonObject
  }>({
    maxSteps: MAX_TERMINAL_STEPS,
    timeoutMs: TERMINAL_LOOP_TIMEOUT_MS,
    onRound: async () => {
      ctx.checkCancelled()
      const ai = (await model.invoke(messages)) as AIMessage
      messages.push(ai)
      const toolCalls = getToolCalls(ai)
      if (toolCalls.length === 0) {
        const rawText = getMessageText(ai.content).trim()
        return {
          done: true as const,
          value: {
            success: false,
            code: 'invalid_input' as const,
            message: rawText || 'terminal_exec must continue via terminal tools'
          }
        }
      }

      const out = (await toolNode.invoke({ messages: [ai] })) as ToolNodeInvokeResult
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)

      if (!terminal.state.finish.done) {
        return { done: false as const }
      }

      if (terminal.state.finish.success) {
        return {
          done: true as const,
          value: {
            success: true,
            code: 'ok' as const,
            message: terminal.state.finish.summary || 'terminal objective completed',
            data: {
              steps: terminal.state.stepIndex
            }
          }
        }
      }

      return {
        done: true as const,
        value: {
          success: false,
          code:
            terminal.state.finish.resultCode && terminal.state.finish.resultCode !== 'ok'
              ? terminal.state.finish.resultCode
              : 'failed',
          message: terminal.state.finish.summary || 'terminal_exec finished with failure'
        }
      }
    }
  })

  if (!loopResult.ok) {
    if (loopResult.reason === 'timeout') {
      return markTaskFailed(
        ctx,
        state,
        task.id,
        `terminal_exec loop timed out after ${TERMINAL_LOOP_TIMEOUT_MS}ms`,
        'bounded_loop_error',
        {
          timeoutMs: TERMINAL_LOOP_TIMEOUT_MS,
          rounds: loopResult.rounds
        }
      )
    }
    return markTaskFailed(
      ctx,
      state,
      task.id,
      `terminal_exec exceeded max steps (${MAX_TERMINAL_STEPS})`,
      'bounded_loop_error',
      {
        maxSteps: MAX_TERMINAL_STEPS,
        rounds: loopResult.rounds
      }
    )
  }

  if (!loopResult.value.success) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      loopResult.value.message,
      loopResult.value.code && loopResult.value.code !== 'ok' ? loopResult.value.code : 'failed',
      loopResult.value.data
    )
  }

  return completeTask({
    ctx,
    state,
    task,
    code: 'ok',
    message: loopResult.value.message,
    outputText: loopResult.value.message,
    data: loopResult.value.data
  })
}

const executeDocxCapability: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const objective = resolveTaskObjective(state, task)
  if (!objective) {
    return markTaskFailed(ctx, state, task.id, 'docx capability requires objective input', 'invalid_input')
  }

  const workspaceId = String(ctx.workspace?.workspaceId || '').trim()
  const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
  if (!workspaceId || !workspaceRootPath) {
    ctx.sendEvent({
      type: 'workspace_required',
      runId: state.runId,
      taskId: task.id,
      reason: 'docx capability requires workspace binding before execution',
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now()
    })
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'workspace is required for docx capability',
      'workspace_required'
    )
  }

  const cfg = await ctx.getModelConfig()
  const docx = buildDocxCapabilityTools({
    ctx,
    runId: state.runId,
    taskId: task.id,
    workspaceRootPath,
    safePreviewChars: DOCX_SAFE_PREVIEW_CHARS,
    emitActivity: (activity) => {
      emitActivity({
        ctx,
        runId: state.runId,
        taskId: task.id,
        actionType: activity.actionType,
        status: activity.status,
        summary: activity.summary
      })
    }
  })
  const toolNode = new ToolNode(docx.tools)
  const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(docx.tools)
  const messages: BaseMessage[] = [
    new SystemMessage(
      [
        'You are the `docx` capability.',
        'Use only the tools: docx_inspect, docx_apply_edits, docx_save_output, docx_finish.',
        'Always inspect before applying edits or saving output.',
        'When overwrite is rejected, choose a new save-as output path.',
        'Finish explicitly with docx_finish. Never return plain-text completion.'
      ].join('\n')
    ),
    new HumanMessage(
      [
        `Objective:\n${objective}`,
        `Workspace root:\n${workspaceRootPath}`,
        `Task title:\n${task.title}`,
        `Loop limit:\n${MAX_DOCX_STEPS} tool rounds, ${DOCX_LOOP_TIMEOUT_MS}ms timeout.`,
        task.toolInput?.kind === 'docx' && task.toolInput.sourcePath
          ? `Suggested source path:\n${task.toolInput.sourcePath}`
          : '',
        task.toolInput?.kind === 'docx' && task.toolInput.outputPath
          ? `Suggested output path:\n${task.toolInput.outputPath}`
          : ''
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  ]

  const loopResult = await runBoundedLoop<{
    success: boolean
    code?: AiTaskResultCode
    message: string
    data?: JsonObject
  }>({
    maxSteps: MAX_DOCX_STEPS,
    timeoutMs: DOCX_LOOP_TIMEOUT_MS,
    onRound: async () => {
      ctx.checkCancelled()
      const ai = (await model.invoke(messages)) as AIMessage
      messages.push(ai)
      const toolCalls = getToolCalls(ai)
      if (toolCalls.length === 0) {
        const rawText = getMessageText(ai.content).trim()
        return {
          done: true as const,
          value: {
            success: false,
            code: 'invalid_input' as const,
            message: rawText || 'docx capability must continue via docx tools'
          }
        }
      }

      const out = (await toolNode.invoke({ messages: [ai] })) as ToolNodeInvokeResult
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)

      if (!docx.state.finish.done) {
        return { done: false as const }
      }

      if (docx.state.finish.success) {
        return {
          done: true as const,
          value: {
            success: true,
            code: 'ok' as const,
            message: docx.state.finish.summary || 'docx objective completed',
            data: docx.state.outputPath
              ? {
                  outputPath: docx.state.outputPath
                }
              : undefined
          }
        }
      }

      return {
        done: true as const,
        value: {
          success: false,
          code:
            docx.state.finish.resultCode && docx.state.finish.resultCode !== 'ok'
              ? docx.state.finish.resultCode
              : 'failed',
          message: docx.state.finish.summary || 'docx capability finished with failure'
        }
      }
    }
  })

  if (!loopResult.ok) {
    if (loopResult.reason === 'timeout') {
      return markTaskFailed(
        ctx,
        state,
        task.id,
        `docx loop timed out after ${DOCX_LOOP_TIMEOUT_MS}ms`,
        'bounded_loop_error',
        {
          timeoutMs: DOCX_LOOP_TIMEOUT_MS,
          rounds: loopResult.rounds
        }
      )
    }
    return markTaskFailed(
      ctx,
      state,
      task.id,
      `docx capability exceeded max steps (${MAX_DOCX_STEPS})`,
      'bounded_loop_error',
      {
        maxSteps: MAX_DOCX_STEPS,
        rounds: loopResult.rounds
      }
    )
  }

  if (!loopResult.value.success) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      loopResult.value.message,
      loopResult.value.code && loopResult.value.code !== 'ok' ? loopResult.value.code : 'failed',
      loopResult.value.data
    )
  }

  return completeTask({
    ctx,
    state,
    task,
    code: 'ok',
    message: loopResult.value.message,
    outputText: loopResult.value.message,
    data: loopResult.value.data
  })
}

const capabilityRegistry = new Map<string, CapabilityExecutor>()

const registerCapability = (kind: string, executor: CapabilityExecutor) => {
  capabilityRegistry.set(String(kind || '').trim(), executor)
}

registerCapability('local_kb_retrieval', executeLocalKbRetrieval)
registerCapability('terminal_exec', executeTerminalExec)
registerCapability('docx', executeDocxCapability)

const capabilityNode = async (ctx: AiRunContext, state: AiRunState): Promise<Partial<AiRunState>> => {
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
    return markTaskFailed(ctx, state, task.id, `unsupported capability kind: ${rawKind || '(empty)'}`)
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
