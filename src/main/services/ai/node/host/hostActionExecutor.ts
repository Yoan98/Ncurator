import { emitActivity } from '../../../../utils/aiCapabilityUtils'
import type { CapabilityExecutor } from '../../../../utils/aiCapabilityUtils'
import { toString } from '../../../../utils/decoder'
import type { AiPlanTask, AiRunEvent, AiTaskKind } from '../../../../../shared/types'
import type { AiHostAction, AiHostCreatePlanTaskInput, AiRunContext, AiRunState } from '../../types'

const KNOWN_CAPABILITY_KINDS: AiTaskKind[] = ['local_kb_retrieval', 'terminal_exec', 'docx']
const MAX_CONTEXT_EVIDENCE_ITEMS = 24
const MAX_CONTEXT_EVIDENCE_CHARS = 240

const isKnownCapabilityKind = (kind: string): kind is AiTaskKind => {
  return KNOWN_CAPABILITY_KINDS.includes(kind as AiTaskKind)
}

const normalizePlannedKind = (kind?: string): AiTaskKind | null => {
  const value = String(kind || '').trim()
  if (!value) return 'local_kb_retrieval'
  if (!isKnownCapabilityKind(value)) return null
  return value
}

type PlannedTaskResult = {
  task: AiPlanTask | null
  rejection?: string
}

const toPlannedTask = (value: AiHostCreatePlanTaskInput, index: number): PlannedTaskResult => {
  const kind = normalizePlannedKind(value.kind)
  if (!kind) {
    const rejectedKind = String(value.kind || '').trim() || '(empty)'
    return {
      task: null,
      rejection: `task[${index + 1}] rejected: unsupported capability kind "${rejectedKind}"`
    }
  }

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
    task: {
      id: toString(value.id || `task-${index + 1}`),
      title: toString(value.title || 'Task'),
      kind,
      input: normalizedInput,
      toolInput,
      status: 'pending',
      attempts: 0
    }
  }
}

export const pickNextTask = (plan: AiPlanTask[]) => {
  for (const task of plan) {
    if (task.status === 'running') return task
  }
  for (const task of plan) {
    if (task.status === 'pending') return task
  }
  return null
}

const appendContextEvidence = (evidence: string[], text: string): string[] => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return evidence
  const clipped = normalized.slice(0, MAX_CONTEXT_EVIDENCE_CHARS)
  if (evidence.includes(clipped)) return evidence
  return [...evidence, clipped].slice(-MAX_CONTEXT_EVIDENCE_ITEMS)
}

const markInternalEvent = (event: AiRunEvent): AiRunEvent => {
  switch (event.type) {
    case 'run_started':
    case 'run_completed':
    case 'run_failed':
    case 'run_cancelled':
    case 'answer_token':
    case 'answer_completed':
    case 'plan_created':
      return event
    default:
      return {
        ...event,
        internal: true,
        stage: 'context_enrichment'
      }
  }
}

const resolveRetrieveContextToolInput = (
  action: Extract<AiHostAction, { action: 'retrieve_context' }>
) => {
  const objective = String(action.objective || '').trim()
  if (action.capabilityKind === 'terminal_exec') {
    return {
      kind: 'terminal_exec' as const,
      objective,
      preferredCwd: action.preferredCwd
    }
  }
  if (action.capabilityKind === 'docx') {
    return {
      kind: 'docx' as const,
      objective,
      sourcePath: action.sourcePath,
      outputPath: action.outputPath
    }
  }
  return {
    kind: 'local_kb_retrieval' as const,
    objective
  }
}

const executeRetrieveContextAction = async (input: {
  ctx: AiRunContext
  state: AiRunState
  action: Extract<AiHostAction, { action: 'retrieve_context' }>
  capabilityRegistry: Map<string, CapabilityExecutor>
}): Promise<Partial<AiRunState>> => {
  const { ctx, state, action, capabilityRegistry } = input
  const taskId = `ctx-${state.contextEnrichmentRounds + 1}-${action.capabilityKind}`
  const objective = String(action.objective || '').trim()

  emitActivity({
    ctx,
    runId: state.runId,
    actionType: 'host_retrieve_context',
    status: 'started',
    summary: `上下文补充：${action.capabilityKind}`
  })

  if (!objective) {
    const summary = 'retrieve_context requires objective'
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_retrieve_context',
      status: 'failed',
      summary
    })
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      contextEnrichmentRounds: state.contextEnrichmentRounds + 1,
      lastHostAction: 'retrieve_context',
      contextEvidence: appendContextEvidence(state.contextEvidence, summary)
    }
  }

  const executor = capabilityRegistry.get(action.capabilityKind)
  if (!executor) {
    const summary = `unsupported capability for retrieve_context: ${action.capabilityKind}`
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_retrieve_context',
      status: 'failed',
      summary
    })
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      contextEnrichmentRounds: state.contextEnrichmentRounds + 1,
      lastHostAction: 'retrieve_context',
      contextEvidence: appendContextEvidence(state.contextEvidence, summary)
    }
  }

  const requiresWorkspace = action.capabilityKind === 'terminal_exec' || action.capabilityKind === 'docx'
  const hasWorkspace = Boolean(
    String(ctx.workspace?.workspaceId || '').trim() && String(ctx.workspace?.rootPath || '').trim()
  )
  if (requiresWorkspace && !hasWorkspace) {
    const reason = `${action.capabilityKind} requires workspace binding for context enrichment`
    ctx.sendEvent({
      type: 'workspace_required',
      runId: state.runId,
      taskId,
      reason,
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now(),
      internal: true,
      stage: 'context_enrichment'
    })
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_retrieve_context',
      status: 'failed',
      summary: reason
    })
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      contextEnrichmentRounds: state.contextEnrichmentRounds + 1,
      lastHostAction: 'retrieve_context',
      contextEvidence: appendContextEvidence(state.contextEvidence, reason)
    }
  }

  const internalTask: AiPlanTask = {
    id: taskId,
    title: `Context Enrichment (${action.capabilityKind})`,
    kind: action.capabilityKind,
    input: objective,
    toolInput: resolveRetrieveContextToolInput(action),
    status: 'running',
    attempts: 0
  }

  const internalState: AiRunState = {
    ...state,
    plan: [internalTask],
    activeTaskId: taskId
  }

  const internalCtx: AiRunContext = {
    ...ctx,
    sendEvent: (event) => ctx.sendEvent(markInternalEvent(event)),
    requestApproval: (request) =>
      ctx.requestApproval({
        ...request,
        internal: true,
        stage: 'context_enrichment'
      })
  }

  let result: Partial<AiRunState>
  try {
    result = await executor(internalCtx, internalState, internalTask)
  } catch (error) {
    const summary = `context enrichment execution error: ${
      error instanceof Error ? error.message : String(error)
    }`
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_retrieve_context',
      status: 'failed',
      summary
    })
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      outputText: summary,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      contextEnrichmentRounds: state.contextEnrichmentRounds + 1,
      lastHostAction: 'retrieve_context',
      contextEvidence: appendContextEvidence(state.contextEvidence, summary)
    }
  }

  const internalPlan = Array.isArray(result.plan) ? result.plan : internalState.plan
  const internalTaskResult = internalPlan.find((item) => item.id === taskId)
  const note =
    String(result.outputText || '').trim() ||
    String(internalTaskResult?.resultMessage || '').trim() ||
    String(internalTaskResult?.error || '').trim() ||
    `${action.capabilityKind} context enrichment completed`

  emitActivity({
    ctx,
    runId: state.runId,
    actionType: 'host_retrieve_context',
    status: internalTaskResult?.status === 'failed' ? 'failed' : 'completed',
    summary: note
  })

  return {
    plan: state.plan,
    activeTaskId: undefined,
    status: 'running',
    error: undefined,
    outputText: note,
    hostDecisionRounds: state.hostDecisionRounds + 1,
    contextEnrichmentRounds: state.contextEnrichmentRounds + 1,
    lastHostAction: 'retrieve_context',
    contextEvidence: appendContextEvidence(state.contextEvidence, note)
  }
}

const executeCreatePlanAction = (input: {
  ctx: AiRunContext
  state: AiRunState
  action: Extract<AiHostAction, { action: 'create_plan' }>
}): Partial<AiRunState> => {
  const { ctx, state, action } = input
  const parsed = (Array.isArray(action.tasks) ? action.tasks : [])
    .map((task, index) => toPlannedTask(task, index))
    .filter((item) => item.task || item.rejection)
  const mapped = parsed
    .map((item) => item.task)
    .filter((task): task is AiPlanTask => Boolean(task))
  const rejections = parsed
    .map((item) => item.rejection)
    .filter((reason): reason is string => Boolean(reason))

  for (const rejection of rejections) {
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_create_plan',
      status: 'failed',
      summary: rejection
    })
  }

  if (mapped.length === 0) {
    const summary =
      rejections.length > 0
        ? 'create_plan did not contain any supported capability tasks'
        : 'create_plan returned empty tasks'
    emitActivity({
      ctx,
      runId: state.runId,
      actionType: 'host_create_plan',
      status: 'failed',
      summary
    })
    return {
      plan: state.plan,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      lastHostAction: 'create_plan',
      contextEvidence: rejections.reduce(
        (bucket, reason) => appendContextEvidence(bucket, reason),
        appendContextEvidence(state.contextEvidence, summary)
      )
    }
  }

  ctx.sendEvent({
    type: 'plan_created',
    runId: state.runId,
    plan: mapped,
    stage: 'plan_execution'
  })
  emitActivity({
    ctx,
    runId: state.runId,
    actionType: 'host_create_plan',
    status: 'completed',
    summary:
      rejections.length > 0
        ? `计划已生成（${mapped.length} 个任务，已拒绝 ${rejections.length} 个不支持任务）`
        : `计划已生成（${mapped.length} 个任务）`
  })

  const next = pickNextTask(mapped)
  if (!next) {
    return {
      plan: mapped,
      activeTaskId: undefined,
      status: 'running',
      error: undefined,
      hostDecisionRounds: state.hostDecisionRounds + 1,
      lastHostAction: 'create_plan'
    }
  }

  const updated: AiPlanTask[] = mapped.map((task) =>
    task.id === next.id ? { ...task, status: 'running' as const } : task
  )
  ctx.sendEvent({
    type: 'task_started',
    runId: state.runId,
    taskId: next.id,
    stage: 'plan_execution'
  })
  return {
    plan: updated,
    activeTaskId: next.id,
    status: 'running',
    error: undefined,
    hostDecisionRounds: state.hostDecisionRounds + 1,
    lastHostAction: 'create_plan',
    contextEvidence: rejections.reduce(
      (bucket, reason) => appendContextEvidence(bucket, reason),
      state.contextEvidence
    )
  }
}

const executeFinalAnswerAction = async (input: {
  ctx: AiRunContext
  state: AiRunState
  action: Extract<AiHostAction, { action: 'final_answer' }>
  buildFinalAnswer: () => Promise<string>
}): Promise<Partial<AiRunState>> => {
  const { ctx, state, action, buildFinalAnswer } = input
  const provided = String(action.answer || '').trim()
  const outputText = provided || (await buildFinalAnswer())
  emitActivity({
    ctx,
    runId: state.runId,
    actionType: 'host_final_answer',
    status: 'completed',
    summary: 'host 已输出最终答复'
  })
  return {
    plan: state.plan,
    activeTaskId: undefined,
    status: 'completed',
    outputText,
    error: undefined,
    hostDecisionRounds: state.hostDecisionRounds + 1,
    lastHostAction: 'final_answer'
  }
}

export const executeHostAction = async (input: {
  ctx: AiRunContext
  state: AiRunState
  action: AiHostAction
  capabilityRegistry: Map<string, CapabilityExecutor>
  buildFinalAnswer: () => Promise<string>
}): Promise<Partial<AiRunState>> => {
  const { action } = input
  if (action.action === 'retrieve_context') {
    return executeRetrieveContextAction({
      ctx: input.ctx,
      state: input.state,
      action,
      capabilityRegistry: input.capabilityRegistry
    })
  }
  if (action.action === 'create_plan') {
    return executeCreatePlanAction({
      ctx: input.ctx,
      state: input.state,
      action
    })
  }
  return executeFinalAnswerAction({
    ctx: input.ctx,
    state: input.state,
    action,
    buildFinalAnswer: input.buildFinalAnswer
  })
}
