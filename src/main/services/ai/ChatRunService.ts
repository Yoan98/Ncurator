import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { AiRunService } from './AiRunService'
import { classifyThrownErrorToAiRunFailure } from './utils/runFailure'
import { resolveAiRunFailurePresentation } from './runFailureCatalog'
import { terminalSessionManager } from './human/tools/terminal/TerminalSessionManager'
import type { AiRunResourceManager } from './run/AiRunResourceManager'
import { normalizeSelectedReferences } from './utils/runContext'
import { validateSelectedReferencesForRun } from '../sourceScope/validation'
import { deletePartnerRootDir } from '../assets/WorkspaceAssetService'
import type { AiFileChangeService } from './fileChanges/AiFileChangeService'
import type { DocxApplyService } from './human/tools/docx/review/DocxApplyService'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { PartnerStore } from '../storage/domains/PartnerStore'
import type { AiRunStore } from '../storage/domains/AiRunStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { WorkspaceStore } from '../storage/domains/WorkspaceStore'
import type { WorkspaceIndexJobStore } from '../storage/domains/WorkspaceIndexJobStore'
import type { WebSourceStore } from '../storage/domains/WebSourceStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { BrowserEmbedService } from '../browser/BrowserEmbedService'
import type { WebCrawlerService } from '../webCrawler/types'
import type { TelemetryService } from '../telemetry/TelemetryService'
import type { AppErrorLogService } from '../logging/AppErrorLogService'
import type { AiRunDeps } from './types'
import { PRODUCT_NAME_ZH } from '../../../shared/constants'
import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AiArtifactRef,
  AiExecutionPermission,
  AiLlmIoRecord,
  AiPreference,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  AiRunCancelResponse,
  AiRunEvent,
  AiRunRecord,
  ChatMessage,
  PartnerClearContextResponse,
  PartnerOpenRequest,
  PartnerOpenResponse,
  PartnerRunSummariesResponse,
  PartnerSnapshotResponse,
  ChatTurnRetractLatestRequest,
  ChatTurnRetractLatestResponse,
  ChatSubmitRequest,
  ChatSubmitResponse,
  AskUserQuestionResult,
  AiRunHumanInteractionRequest,
  AiRunHumanInteractionResponse,
  PendingHumanInteraction,
  UserQuestion,
  JsonObject
} from '../../../shared/types'
import { projectAiConversationMessages } from '../../../shared/workbench/conversationProjection'

type ActiveApproval = {
  batchId: string
  taskId: string
  itemIds: string[]
  items: AiApprovalBatchItem[]
  internal?: boolean
  stage?: AiRunEvent['stage']
  resolve: (
    result:
      | {
          accepted: true
          decisions: AiApprovalBatchDecision[]
        }
      | { accepted: false; error: string }
  ) => void
}

type ActiveQuestion = {
  interactionId: string
  taskId: string
  toolCallId: string
  questions: UserQuestion[]
  resolve: (result: { accepted: true; result: AskUserQuestionResult } | { accepted: false; error: string }) => void
}

type ActiveRun = {
  run: AiRunRecord
  cancelled: boolean
  deleted: boolean
  abortController: AbortController
  eventQueue: Promise<void>
  projectionFlushTimer: ReturnType<typeof setTimeout> | null
}

type ChatRunServiceDeps = {
  partnerStore: PartnerStore
  chatMessageLogStore: ChatMessageLogStore
  aiRunStore: AiRunStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  llmStore: LlmConfigStore
  workspaceStore: WorkspaceStore
  workspaceIndexJobStore: WorkspaceIndexJobStore
  webSourceStore: WebSourceStore
  ensureEmbeddingReady: () => Promise<void>
  docxApplyService: DocxApplyService
  aiFileChangeService: AiFileChangeService
  runResourceManager: AiRunResourceManager
  browserUseService?: BrowserEmbedService
  webCrawlerService?: WebCrawlerService
  scheduledTaskService?:
    | import('../scheduler/ScheduledTaskService').ScheduledTaskService
    | (() => import('../scheduler/ScheduledTaskService').ScheduledTaskService | undefined)
  telemetryService?: TelemetryService
  errorLogService?: AppErrorLogService
  recordLlmIo?: (record: AiLlmIoRecord) => void
  broadcastEvent?: (event: AiRunEvent) => void
  autoStartRuns?: boolean
  resolveHumanRuntimeOverrides?: (
    run: AiRunRecord
  ) => AiRunDeps['humanRuntimeOverrides'] | undefined
  onRunTerminal?: (
    run: AiRunRecord,
    status: Extract<AiRunRecord['status'], 'completed' | 'failed' | 'cancelled'>
  ) => void | Promise<void>
}

const ACTIVE_RUN_STATUSES: AiRunRecord['status'][] = ['running', 'waiting_human', 'waiting_approval']
const INTERRUPTED_RUN_MESSAGE = '运行已中断，请重新发送消息。'
const PARTIAL_SAVE_DELAY_MS = 500

const normalizeAiPreference = (value: unknown): AiPreference =>
  value === 'local_sources_relaxed' || value === 'local_sources_strict' ? value : 'default'

const normalizeExecutionPermission = (
  value: AiExecutionPermission | undefined
): AiExecutionPermission => (value === 'full_access' ? 'full_access' : 'review')

const appendArtifact = (artifacts: AiArtifactRef[] | undefined, artifact: AiArtifactRef) => {
  const current = artifacts || []
  const key = `${artifact.kind}:${artifact.path}:${artifact.applyId || ''}`
  if (current.some((item) => `${item.kind}:${item.path}:${item.applyId || ''}` === key)) {
    return current
  }
  return [...current, artifact]
}

export class ChatRunService {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly activeApprovals = new Map<string, ActiveApproval>()
  private readonly activeQuestions = new Map<string, ActiveQuestion>()
  private readonly pendingPartnerSubmissions = new Set<string>()

  public constructor(private readonly deps: ChatRunServiceDeps) {}

  private async loadProjectedPartnerMessages(partnerId: string): Promise<ChatMessage[]> {
    const [records, runs] = await Promise.all([
      this.deps.chatMessageLogStore.list(partnerId),
      this.deps.aiRunStore.listRunsByPartner(partnerId)
    ])
    return projectAiConversationMessages({ partnerId, records, runs })
  }

  private async getProjectedMessagesPage(input: {
    partnerId: string
    limit: number
    beforeTimestamp?: number
  }): Promise<{ messages: ChatMessage[]; hasMoreBefore: boolean }> {
    const safeLimit = Math.max(1, Math.min(100, Number(input.limit || 50)))
    const sorted = (await this.loadProjectedPartnerMessages(input.partnerId)).sort(
      (left, right) => left.timestamp - right.timestamp
    )
    const beforeTimestamp = Number(input.beforeTimestamp)
    const eligible = Number.isFinite(beforeTimestamp)
      ? sorted.filter((message) => message.timestamp < beforeTimestamp)
      : sorted
    const hasMoreBefore = eligible.length > safeLimit
    return {
      messages: eligible.slice(-safeLimit),
      hasMoreBefore
    }
  }

  public async listPartnerMessages(partnerId: string): Promise<ChatMessage[]> {
    return await this.loadProjectedPartnerMessages(partnerId)
  }

  public hasActivePartnerRun(partnerId: string): boolean {
    const id = String(partnerId || '').trim()
    if (!id) return false
    return (
      this.pendingPartnerSubmissions.has(id) ||
      Array.from(this.activeRuns.values()).some((entry) => entry.run.partnerId === id)
    )
  }

  public async failInterruptedRuns(): Promise<void> {
    const interrupted = await this.deps.aiRunStore.listRunsByStatuses(['running'])
    for (const run of interrupted) {
      const now = Date.now()
      const nextRun: AiRunRecord = {
        ...run,
        status: 'failed',
        failureCode: 'process_interrupted',
        error: INTERRUPTED_RUN_MESSAGE,
        partialAnswer: run.partialAnswer || INTERRUPTED_RUN_MESSAGE,
        finalAnswer: run.finalAnswer || INTERRUPTED_RUN_MESSAGE,
        pendingApproval: undefined,
        pendingInteraction: undefined,
        updatedAt: now,
        finishedAt: now
      }
      await this.deps.aiRunStore.saveRun(nextRun)
      try {
        await this.deps.onRunTerminal?.(nextRun, 'failed')
      } catch (error) {
        console.error('[CHAT-RUN] terminal notification failed:', error)
      }
    }
  }

  public async getPartnerSnapshot(partnerId: string): Promise<PartnerSnapshotResponse> {
    const normalizedPartnerId = String(partnerId || '').trim()
    if (!normalizedPartnerId) return { messages: [], runs: [], activeRuns: [] }
    const messages = await this.loadProjectedPartnerMessages(normalizedPartnerId)
    const runs = await this.deps.aiRunStore.listRunsByPartner(normalizedPartnerId)
    const runSnapshots = await Promise.all(runs.map((run) => this.buildRunSnapshot(run)))
    const activeRuns = runSnapshots.filter((snapshot) =>
      ACTIVE_RUN_STATUSES.includes(snapshot.run.status)
    )
    return { messages, runs: runSnapshots, activeRuns }
  }

  public async openPartner(input: PartnerOpenRequest): Promise<PartnerOpenResponse> {
    const startedAt = Date.now()
    const normalizedPartnerId = String(input.partnerId || '').trim()
    if (!normalizedPartnerId) return { messages: [], hasMoreBefore: false, activeRuns: [] }
    const [partner, page, activeRunRecords] = await Promise.all([
      this.deps.partnerStore.getPartner(normalizedPartnerId),
      this.getProjectedMessagesPage({
        partnerId: normalizedPartnerId,
        limit: input.limit || 50,
        beforeTimestamp: input.beforeTimestamp
      }),
      this.deps.aiRunStore.listRunsByPartner(normalizedPartnerId, ACTIVE_RUN_STATUSES)
    ])
    const activeRuns = await Promise.all(activeRunRecords.map((run) => this.buildRunSnapshot(run)))
    const response: PartnerOpenResponse = {
      partner: partner || undefined,
      messages: page.messages,
      hasMoreBefore: page.hasMoreBefore,
      activeRuns
    }
    this.logSlowChatQuery('partner-open', startedAt, {
      partnerId: normalizedPartnerId,
      messages: response.messages.length,
      activeRuns: response.activeRuns.length
    })
    return response
  }

  public async getPartnerRunSummaries(partnerId: string): Promise<PartnerRunSummariesResponse> {
    const startedAt = Date.now()
    const normalizedPartnerId = String(partnerId || '').trim()
    if (!normalizedPartnerId) return { runs: [] }
    const runs = await this.deps.aiRunStore.listRunsByPartner(normalizedPartnerId)
    const recentRuns = [...runs]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 50)
    const response = {
      runs: await Promise.all(recentRuns.map((run) => this.buildRunSnapshot(run)))
    }
    this.logSlowChatQuery('partner-run-summaries', startedAt, {
      partnerId: normalizedPartnerId,
      runs: response.runs.length
    })
    return response
  }

  public async retractLatestTurn(
    payload: ChatTurnRetractLatestRequest
  ): Promise<ChatTurnRetractLatestResponse> {
    const partnerId = String(payload?.partnerId || '').trim()
    const userMessageId = String(payload?.userMessageId || '').trim()
    if (!partnerId || !userMessageId) {
      return { success: false, messages: [], error: 'partnerId and userMessageId are required' }
    }
    const activeRuns = Array.from(this.activeRuns.values()).filter(
      (entry) => entry.run.partnerId === partnerId
    )
    if (activeRuns.length > 0) {
      return { success: false, messages: [], error: '当前伙伴仍在运行，不能编辑消息' }
    }

    const runs = await this.deps.aiRunStore.listRunsByPartner(partnerId)
    const latestRun = [...runs].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (!latestRun || latestRun.userMessageId !== userMessageId) {
      const messages = await this.loadProjectedPartnerMessages(partnerId)
      return { success: false, messages, error: '只能编辑最新一条用户消息' }
    }

    const messages = await this.loadProjectedPartnerMessages(partnerId)
    const target = messages.find((message) => message.id === userMessageId)
    if (!target || target.role !== 'user') {
      return { success: false, messages, error: '只能撤回用户消息' }
    }

    const run = latestRun
    const assistantMessage = messages.find((message) => message.id === run.assistantMessageId)

    await this.deps.aiRunStore.deleteRunsByIds([run.id])
    await this.deps.chatMessageLogStore.deleteByRunIds([run.id])
    const nextMessages = await this.loadProjectedPartnerMessages(partnerId)

    return {
      success: true,
      userMessage: target,
      assistantMessageId: assistantMessage?.id,
      runId: run.id,
      messages: nextMessages
    }
  }

  public async deletePartner(partnerId: string): Promise<void> {
    const normalizedPartnerId = String(partnerId || '').trim()
    if (!normalizedPartnerId) return

    const affectedRuns = Array.from(this.activeRuns.entries()).filter(
      ([, entry]) => entry.run.partnerId === normalizedPartnerId
    )
    for (const [runId, entry] of affectedRuns) {
      entry.cancelled = true
      entry.deleted = true
      entry.abortController.abort()
      this.clearProjectionFlush(runId)
      const approval = this.activeApprovals.get(runId)
      approval?.resolve({ accepted: false, error: '当前伙伴已删除' })
      this.activeApprovals.delete(runId)
    }

    await Promise.all(affectedRuns.map(([, entry]) => entry.eventQueue.catch(() => {})))
    await terminalSessionManager.closeByChatSession(normalizedPartnerId)
    await this.deps.partnerStore.deletePartner(normalizedPartnerId)
    await this.deps.aiRunStore.deleteRunsByPartner(normalizedPartnerId)
    await deletePartnerRootDir(normalizedPartnerId)
  }

  public async clearPartnerContext(partnerId: string): Promise<PartnerClearContextResponse> {
    const normalizedPartnerId = String(partnerId || '').trim()
    if (!normalizedPartnerId) return { success: false, error: 'partnerId is required' }
    const partner = await this.deps.partnerStore.getPartner(normalizedPartnerId)
    if (!partner) return { success: false, error: 'partner not found' }
    if (
      this.pendingPartnerSubmissions.has(normalizedPartnerId) ||
      Array.from(this.activeRuns.values()).some(
        (entry) => entry.run.partnerId === normalizedPartnerId
      )
    ) {
      return { success: false, error: '当前伙伴仍在运行，不能清空消息记录' }
    }
    const clearedAt = Date.now()
    // 物理删除消息 log 与 ai_run；保留 ai_file_change（回退入口）与伙伴 / UI 状态。
    await this.deps.chatMessageLogStore.deleteByPartner(normalizedPartnerId)
    await this.deps.aiRunStore.deleteRunsByPartner(normalizedPartnerId)
    return { success: true, clearedAt }
  }

  public async submit(payload: ChatSubmitRequest): Promise<ChatSubmitResponse> {
    const partnerId = String(payload?.partnerId || '').trim()
    const input = String(payload?.input || '').trim()
    if (!partnerId) return { success: false, error: 'partnerId is required' }
    if (!input) return { success: false, error: 'input is required' }
    if (
      this.pendingPartnerSubmissions.has(partnerId) ||
      Array.from(this.activeRuns.values()).some((entry) => entry.run.partnerId === partnerId)
    ) {
      this.deps.telemetryService?.track('message_submit_completed', {
        outcome: 'failed',
        failureCode: 'REQUEST_FAILED'
      })
      return { success: false, error: '当前伙伴已有运行中的任务，请等待完成后再发送。' }
    }
    this.pendingPartnerSubmissions.add(partnerId)
    try {
      const response = await this.submitAi({ ...payload, partnerId, input })
      this.trackSubmitResult(response)
      return response
    } catch (error) {
      this.deps.telemetryService?.track('message_submit_completed', {
        outcome: 'failed',
        failureCode: 'UNKNOWN'
      })
      throw error
    } finally {
      this.pendingPartnerSubmissions.delete(partnerId)
    }
  }

  private trackSubmitResult(response: ChatSubmitResponse): void {
    if (response.success) {
      this.deps.telemetryService?.track('message_submit_completed', {
        outcome: 'succeeded'
      })
      return
    }
    this.deps.telemetryService?.track('message_submit_completed', {
      outcome: 'failed',
      failureCode: 'REQUEST_FAILED'
    })
  }

  public async cancelRun(runId: string): Promise<AiRunCancelResponse> {
    const normalizedRunId = String(runId || '').trim()
    const entry = this.activeRuns.get(normalizedRunId)
    if (!entry) return { success: false, error: '当前运行已结束' }
    entry.cancelled = true
    entry.abortController.abort()
    await terminalSessionManager.stopByRun(normalizedRunId)
    const approval = this.activeApprovals.get(normalizedRunId)
    approval?.resolve({ accepted: false, error: '已取消' })
    this.activeApprovals.delete(normalizedRunId)
    const question = this.activeQuestions.get(normalizedRunId)
    question?.resolve({ accepted: false, error: '已取消' })
    this.activeQuestions.delete(normalizedRunId)
    return { success: true }
  }

  public async submitHumanInteraction(
    payload: AiRunHumanInteractionRequest
  ): Promise<AiRunHumanInteractionResponse> {
    const runId = String(payload?.runId || '').trim()
    const pending = this.activeQuestions.get(runId)
    if (!pending) return { success: false, error: '当前运行没有待回答问题' }
    if (pending.interactionId !== payload.interactionId) {
      return { success: false, error: 'interaction not found' }
    }
    const answers = Array.isArray(payload.answers?.answers) ? payload.answers.answers : []
    if (answers.length !== pending.questions.length) return { success: false, error: '每个问题都必须回答' }
    const questionIds = new Set(pending.questions.map((question) => question.id))
    const seenAnswerIds = new Set<string>()
    for (const answer of answers) {
      if (!answer || !questionIds.has(answer.id) || seenAnswerIds.has(answer.id) || !Array.isArray(answer.selected)) {
        return { success: false, error: '答案格式无效' }
      }
      seenAnswerIds.add(answer.id)
      const question = pending.questions.find((item) => item.id === answer.id)
      const optionIds = new Set(question?.options.map((option) => option.id) || [])
      if (answer.selected.some((id) => !optionIds.has(id))) return { success: false, error: '存在无效选项' }
      if (question && !question.multiSelect && answer.selected.length > 1) {
        return { success: false, error: '单选问题只能选择一个选项' }
      }
      if (answer.selected.length === 0 && !String(answer.custom || '').trim()) {
        return { success: false, error: '请选择选项或填写其他内容' }
      }
    }
    await this.queueRunEvent(runId, {
      type: 'human_interaction_resolved',
      runId,
      taskId: pending.taskId,
      interactionId: pending.interactionId,
      kind: 'question',
      result: JSON.parse(JSON.stringify(payload.answers)) as JsonObject,
      resolvedAt: Date.now()
    })
    this.activeQuestions.delete(runId)
    pending.resolve({ accepted: true, result: payload.answers })
    return { success: true }
  }

  public async decideApprovalBatch(
    payload: AiRunApprovalBatchDecisionRequest
  ): Promise<AiRunApprovalBatchDecisionResponse> {
    const runId = String(payload?.runId || '').trim()
    const batchId = String(payload?.batchId || '').trim()
    if (!runId || !batchId) return { success: false, error: 'runId and batchId are required' }

    const pending = this.activeApprovals.get(runId)
    if (!pending) return { success: false, error: '当前运行已结束' }
    if (pending.batchId !== batchId) return { success: false, error: 'approval batch not found' }

    const decisions = Array.isArray(payload?.decisions) ? payload.decisions : []
    if (decisions.length !== pending.itemIds.length) {
      return { success: false, error: 'each approval item must have exactly one decision' }
    }

    const seenIds = new Set<string>()
    for (const decision of decisions) {
      const itemId = String(decision?.itemId || '').trim()
      const action = String(decision?.action || '').trim()
      if (!itemId || !pending.itemIds.includes(itemId) || seenIds.has(itemId)) {
        return { success: false, error: 'invalid approval decision items' }
      }
      if (action !== 'approve' && action !== 'reject' && action !== 'guide') {
        return { success: false, error: 'invalid approval decision action' }
      }
      if (action === 'guide' && !String(decision?.message || '').trim()) {
        return { success: false, error: 'guide decision requires non-empty message' }
      }
      seenIds.add(itemId)
    }

    const normalizedDecisions = decisions.map((decision) => ({
      itemId: String(decision.itemId).trim(),
      action: decision.action,
      message: typeof decision.message === 'string' ? decision.message.trim() : undefined
    }))
    const decisionEvent: AiRunEvent = {
      type: 'approval_batch_decision',
      runId,
      taskId: pending.taskId,
      batchId,
      decisions: normalizedDecisions,
      decidedAt: Date.now(),
      internal: pending.internal,
      stage: pending.stage
    }
    const persisted = await this.deps.aiRunStore.decideApprovalBatchTransaction({
      runId,
      request: payload
    })
    if (!persisted.ok) return { success: false, error: persisted.error || 'approval failed' }

    const entry = this.activeRuns.get(runId)
    if (entry) {
      entry.run = {
        ...entry.run,
        ...(persisted.run || {}),
        status: 'running',
        pendingApproval: undefined,
        pendingInteraction: undefined
      }
    }

    this.activeApprovals.delete(runId)
    this.broadcastEvent(decisionEvent)
    pending.resolve({
      accepted: true,
      decisions: normalizedDecisions
    })

    return { success: true }
  }

  private async buildRunSnapshot(run: AiRunRecord) {
    const records = await this.deps.chatMessageLogStore.listByRun(run.id)
    return {
      run,
      messageLogRecords: records,
      pendingApproval: run.pendingApproval,
      pendingInteraction: run.pendingInteraction
    }
  }

  private logSlowChatQuery(
    label: string,
    startedAt: number,
    metadata: Record<string, unknown>
  ): void {
    const durationMs = Date.now() - startedAt
    if (durationMs < 300 || process.env.NODE_ENV === 'production') return
    console.debug('[CHAT-PERF]', { label, durationMs, ...metadata })
  }

  private async submitAi(
    payload: ChatSubmitRequest & { partnerId: string; input: string }
  ): Promise<ChatSubmitResponse> {
    const partnerHasActiveRun = Array.from(this.activeRuns.values()).some(
      (entry) => entry.run.partnerId === payload.partnerId
    )
    if (partnerHasActiveRun) {
      return { success: false, error: '当前伙伴已有运行中的任务，请等待完成后再发送。' }
    }
    const partner = await this.deps.partnerStore.getPartner(payload.partnerId)
    if (!partner) return { success: false, error: 'partner not found' }
    const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
    const mainModel = payload.mainModel || null
    const modelName = String(mainModel?.modelName || '').trim()
    const preference = normalizeAiPreference(payload.preference)
    const executionPermission = normalizeExecutionPermission(payload.executionPermission)
    if (!mainModel?.configId || !modelName) {
      return {
        success: false,
        error: '请先在输入框右下角选择主模型'
      }
    }

    const runId = uuidv4()
    const validation = await validateSelectedReferencesForRun({
      references: normalizedReferences,
      workspaceStore: this.deps.workspaceStore,
      webSourceStore: this.deps.webSourceStore,
      sendEvent: () => {},
      runId
    })
    if (!validation.ok) return { success: false, error: validation.error }

    const createdAt = Date.now()
    const userMessage: ChatMessage = {
      id: uuidv4(),
      partner_id: payload.partnerId,
      role: 'user',
      content: payload.input,
      timestamp: createdAt,
      contentNodes: payload.contentNodes,
      selectedReferences: normalizedReferences,
      attachments,
      error: false
    }
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      partner_id: payload.partnerId,
      role: 'assistant',
      content: '',
      timestamp: createdAt + 1
    }
    const run: AiRunRecord = {
      id: runId,
      partnerId: payload.partnerId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      status: 'running',
      input: payload.input,
      selectedReferences: normalizedReferences,
      attachments,
      modelName,
      mainModel,
      preference,
      executionPermission,
      partialAnswer: '',
      artifacts: [],
      createdAt,
      updatedAt: createdAt
    }

    await this.deps.aiRunStore.saveRun(run)

    const activeRun: ActiveRun = {
      run,
      cancelled: false,
      deleted: false,
      abortController: new AbortController(),
      eventQueue: Promise.resolve(),
      projectionFlushTimer: null
    }
    this.activeRuns.set(runId, activeRun)

    if (this.deps.autoStartRuns !== false) {
      void this.startAiRun(runId).catch((error) => {
        console.error('[CHAT-RUN] start failed:', error)
      })
    }

    return {
      success: true,
      userMessage,
      assistantMessage,
      run
    }
  }

  private async startAiRun(runId: string): Promise<void> {
    const entry = this.activeRuns.get(runId)
    if (!entry) return
    const { run } = entry
    const sendEvent = (event: AiRunEvent): void => {
      void this.queueRunEvent(runId, event)
    }
    const partner = await this.deps.partnerStore.getPartner(run.partnerId)
    const workspaceRoots = (await this.deps.workspaceStore.listWorkspaces())
      .map((workspace) => String(workspace.root_path || '').trim())
      .filter(Boolean)
    await this.queueRunEvent(runId, {
      type: 'run_started',
      runId,
      partnerId: run.partnerId,
      createdAt: Date.now(),
      input: run.input
    })
    this.deps.docxApplyService.beginRun({
      runId,
      partnerId: run.partnerId,
      inputText: run.input
    })

    const scheduledTaskService =
      typeof this.deps.scheduledTaskService === 'function'
        ? this.deps.scheduledTaskService()
        : this.deps.scheduledTaskService

    try {
      const result = await AiRunService.getInstance().run(
        {
          runId,
          partnerId: run.partnerId,
          partnerName: partner?.name || PRODUCT_NAME_ZH,
          userMessageId: run.userMessageId,
          assistantMessageId: run.assistantMessageId,
          input: run.input,
          selectedReferences: run.selectedReferences,
          attachments: run.attachments,
          mainModel: run.mainModel,
          preference: run.preference,
          executionPermission: run.executionPermission,
          workspaceRoots
        },
        {
          llmStore: this.deps.llmStore,
          partnerStore: this.deps.partnerStore,
          chatMessageLogStore: this.deps.chatMessageLogStore,
          documentsStore: this.deps.documentsStore,
          embeddingService: this.deps.embeddingService,
          ensureEmbeddingReady: this.deps.ensureEmbeddingReady,
          hasRunningKnowledgeIndexJob: async () =>
            await this.deps.workspaceIndexJobStore.hasRunningPrepareJob(),
          docxApplyService: this.deps.docxApplyService,
          saveFileChangeRecord: async (record) => {
            await this.deps.aiFileChangeService.saveRecord(record)
          },
          listFileChangeRecords: async (request) =>
            (await this.deps.aiFileChangeService.listRecords(request)).items,
          isCancelled: () => Boolean(this.activeRuns.get(runId)?.cancelled),
          abortSignal: this.activeRuns.get(runId)?.abortController.signal,
          sendEvent,
          recordLlmIo: this.deps.recordLlmIo,
          requestApprovalBatch: async (request) => await this.requestApprovalBatch(runId, request),
          requestUserQuestion: async (request) => await this.requestUserQuestion(runId, request),
          browserUseService: this.deps.browserUseService,
          webCrawlerService: this.deps.webCrawlerService,
          scheduledTaskService,
          humanRuntimeOverrides: this.deps.resolveHumanRuntimeOverrides?.(run)
        }
      )

      await this.flushRunEvents(runId)
      if (result.status === 'cancelled') {
        this.deps.docxApplyService.discardRun(runId)
        await this.queueRunEvent(runId, {
          type: 'run_cancelled',
          runId
        })
        return
      }

      if (result.status === 'failed') {
        this.deps.docxApplyService.discardRun(runId)
        this.deps.errorLogService?.write({
          module: 'ai-run',
          error: result.error || 'AI run failed',
          context: {
            source: result.failureSource,
            code: result.failureCode,
            rawMessage: result.failureRawMessage
          }
        })
        // run_failed 已由 AiRunService 唯一发送，这里不再补发。
        return
      }

      const completedRun = await this.getMutableRun(runId)
      if (completedRun && !completedRun.finalAnswer) {
        await this.queueRunEvent(runId, {
          type: 'answer_completed',
          runId,
          taskId: runId,
          text: result.finalDeliveryMarkdown || completedRun.partialAnswer || '',
          stage: 'human_brain'
        })
      }
      await this.flushRunEvents(runId)
      await this.queueRunEvent(runId, { type: 'run_completed', runId })
    } catch (error) {
      this.deps.docxApplyService.discardRun(runId)
      if (this.activeRuns.get(runId)?.cancelled) {
        await this.queueRunEvent(runId, {
          type: 'run_cancelled',
          runId
        })
        return
      }
      console.error('[CHAT-RUN] unexpected failure:', error)
      this.deps.errorLogService?.write({
        module: 'ai-run',
        error: error instanceof Error ? error : String(error),
        context: { source: 'unexpected' }
      })
      const failure = classifyThrownErrorToAiRunFailure(error)
      const presentation = resolveAiRunFailurePresentation(failure.failureCode, failure.rawMessage)
      const failureSource = presentation.source === 'user' ? 'internal' : presentation.source
      await this.queueRunEvent(runId, {
        type: 'run_failed',
        runId,
        source: failureSource,
        message: presentation.message,
        rawMessage: presentation.rawMessage,
        httpStatus: failure.httpStatus,
        providerCode: failure.providerCode,
        code: failure.failureCode
      })
    } finally {
      await this.deps.runResourceManager.releaseRun(runId)
      const approval = this.activeApprovals.get(runId)
      approval?.resolve({ accepted: false, error: 'run closed' })
      this.activeApprovals.delete(runId)
      const question = this.activeQuestions.get(runId)
      question?.resolve({ accepted: false, error: 'run closed' })
      this.activeQuestions.delete(runId)
      await this.flushRunEvents(runId)
      this.clearProjectionFlush(runId)
      this.activeRuns.delete(runId)
    }
  }

  private async requestApprovalBatch(
    runId: string,
    request: {
      taskId: string
      batchId: string
      items: AiApprovalBatchItem[]
      internal?: boolean
      stage?: AiRunEvent['stage']
    }
  ): Promise<
    | {
        accepted: true
        decisions: AiApprovalBatchDecision[]
      }
    | { accepted: false; error: string }
  > {
    if (this.activeRuns.get(runId)?.cancelled) return { accepted: false, error: '当前运行已结束' }
    const run = await this.getMutableRun(runId)
    if (run?.executionPermission === 'full_access') {
      return {
        accepted: true,
        decisions: request.items.map((item) => ({ itemId: item.itemId, action: 'approve' }))
      }
    }
    if (this.activeApprovals.has(runId) || this.activeQuestions.has(runId)) {
      return { accepted: false, error: '已有待处理的人机交互' }
    }

    await this.queueRunEvent(runId, {
      type: 'approval_batch_required',
      runId,
      taskId: request.taskId,
      batchId: request.batchId,
      items: request.items,
      createdAt: Date.now(),
      internal: request.internal,
      stage: request.stage
    })

    return await new Promise((resolve) => {
      this.activeApprovals.set(runId, {
        batchId: request.batchId,
        taskId: request.taskId,
        itemIds: request.items.map((item) => item.itemId),
        items: request.items,
        internal: request.internal,
        stage: request.stage,
        resolve: (result) => {
          this.activeApprovals.delete(runId)
          if (!result.accepted) {
            void this.queueRunEvent(runId, {
              type: 'approval_batch_decision',
              runId,
              taskId: request.taskId,
              batchId: request.batchId,
              decisions: request.items.map((item) => ({
                itemId: item.itemId,
                action: 'reject' as const,
                message: result.error
              })),
              decidedAt: Date.now(),
              internal: request.internal,
              stage: request.stage
            })
          }
          resolve(result)
        }
      })
    })
  }

  private async requestUserQuestion(
    runId: string,
    request: {
      taskId: string
      interactionId: string
      toolCallId: string
      questions: UserQuestion[]
      stage?: AiRunEvent['stage']
    }
  ): Promise<{ accepted: true; result: AskUserQuestionResult } | { accepted: false; error: string }> {
    if (this.activeQuestions.has(runId) || this.activeApprovals.has(runId)) {
      return { accepted: false, error: '已有待处理的人机交互' }
    }
    const interaction: PendingHumanInteraction = {
      kind: 'question',
      interactionId: request.interactionId,
      toolCallId: request.toolCallId,
      questions: request.questions
    }
    const resultPromise = new Promise<
      { accepted: true; result: AskUserQuestionResult } | { accepted: false; error: string }
    >((resolve) => {
      this.activeQuestions.set(runId, {
        interactionId: request.interactionId,
        taskId: request.taskId,
        toolCallId: request.toolCallId,
        questions: request.questions,
        resolve: (result) => {
          this.activeQuestions.delete(runId)
          resolve(result)
        }
      })
    })
    try {
      await this.queueRunEvent(runId, {
        type: 'human_interaction_required',
        runId,
        taskId: request.taskId,
        interactionId: request.interactionId,
        interaction,
        createdAt: Date.now(),
        stage: request.stage
      })
    } catch (error) {
      const pending = this.activeQuestions.get(runId)
      pending?.resolve({ accepted: false, error: error instanceof Error ? error.message : String(error) })
    }
    return await resultPromise
  }

  private queueRunEvent(runId: string, event: AiRunEvent): Promise<void> {
    const entry = this.activeRuns.get(runId)
    if (entry?.deleted) return Promise.resolve()
    const previous = entry?.eventQueue || Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(async () => {
        await this.persistProjectAndBroadcastEvent(runId, event)
      })
    if (entry) {
      entry.eventQueue = next.catch((error) => {
        console.error('[CHAT-RUN] event queue failed:', error)
      })
    }
    return next
  }

  private async flushRunEvents(runId: string): Promise<void> {
    const entry = this.activeRuns.get(runId)
    if (entry) await entry.eventQueue.catch(() => {})
  }

  private async persistProjectAndBroadcastEvent(runId: string, event: AiRunEvent): Promise<void> {
    const entry = this.activeRuns.get(runId)
    if (entry?.deleted) return
    const run = await this.getMutableRun(runId)
    if (!run) return
    await this.projectEvent(runId, run, event)
    if (
      event.type === 'run_completed' ||
      event.type === 'run_failed' ||
      event.type === 'run_cancelled'
    ) {
      try {
        await this.deps.onRunTerminal?.(run, run.status as 'completed' | 'failed' | 'cancelled')
      } catch (error) {
        console.error('[CHAT-RUN] terminal notification failed:', error)
      }
    }
    this.broadcastEvent(event)
  }

  private async getMutableRun(runId: string): Promise<AiRunRecord | null> {
    const entry = this.activeRuns.get(runId)
    if (entry) return entry.run
    return await this.deps.aiRunStore.getRun(runId)
  }

  private async projectEvent(runId: string, run: AiRunRecord, event: AiRunEvent): Promise<void> {
    const entry = this.activeRuns.get(runId)
    const now = Date.now()
    const saveImmediately = event.type !== 'answer_token'

    if (event.type === 'assistant_brain_stream_started') {
      run.partialAnswer = ''
      run.partialAnswerRole = 'answer'
      run.updatedAt = now
    } else if (event.type === 'assistant_brain_stream_delta') {
      run.partialAnswer = `${run.partialAnswer || ''}${event.text}`
      run.updatedAt = now
      this.scheduleProjectionFlush(runId)
    } else if (event.type === 'assistant_brain_stream_reset') {
      run.partialAnswer = ''
      run.partialAnswerRole = 'answer'
      run.updatedAt = now
    } else if (event.type === 'assistant_brain_stream_classified') {
      run.partialAnswerRole = 'thought'
      run.updatedAt = now
    } else if (event.type === 'assistant_brain_stream_completed') {
      run.partialAnswerRole = event.role
      run.partialAnswer = event.text
      run.updatedAt = now
    } else if (event.type === 'assistant_process_thought') {
      run.partialAnswer = ''
      run.partialAnswerRole = 'answer'
      run.updatedAt = now
    } else if (event.type === 'answer_token') {
      run.partialAnswer = `${run.partialAnswer || ''}${event.token}`
      run.partialAnswerRole = 'answer'
      run.updatedAt = now
      this.scheduleProjectionFlush(runId)
    } else if (event.type === 'answer_completed') {
      run.partialAnswer = event.text
      run.partialAnswerRole = 'answer'
      run.finalAnswer = event.text
      run.updatedAt = now
    } else if (event.type === 'file_artifact') {
      run.artifacts = appendArtifact(run.artifacts, {
        kind: 'file',
        capability: event.capability,
        path: event.path,
        fileName: event.fileName,
        operation: event.operation,
        applyId: event.applyId
      })
      run.updatedAt = now
    } else if (event.type === 'approval_batch_required') {
      run.status = 'waiting_approval'
      run.pendingApproval = event
      run.pendingInteraction = {
        kind: 'approval',
        interactionId: event.batchId,
        batchId: event.batchId,
        items: event.items
      }
      run.updatedAt = now
    } else if (event.type === 'approval_batch_decision') {
      run.status = 'running'
      run.pendingApproval = undefined
      run.pendingInteraction = undefined
      run.updatedAt = now
    } else if (event.type === 'human_interaction_required') {
      run.status = 'waiting_human'
      run.pendingInteraction = event.interaction
      run.updatedAt = now
    } else if (event.type === 'human_interaction_resolved') {
      run.status = 'running'
      run.pendingInteraction = undefined
      run.updatedAt = now
    } else if (event.type === 'run_completed') {
      run.status = run.status === 'failed' || run.status === 'cancelled' ? run.status : 'completed'
      run.pendingApproval = undefined
      run.pendingInteraction = undefined
      run.updatedAt = now
      run.finishedAt = now
    } else if (event.type === 'run_failed') {
      run.status = 'failed'
      run.failureCode = event.code
      run.pendingApproval = undefined
      run.pendingInteraction = undefined
      run.error = event.message
      run.failureRawMessage = event.rawMessage
      run.updatedAt = now
      run.finishedAt = now
      const content = run.partialAnswer
        ? `${run.partialAnswer}\n\n失败：${event.message}`
        : `失败：${event.message}`
      run.partialAnswer = content
      run.finalAnswer = content
    } else if (event.type === 'run_cancelled') {
      run.status = 'cancelled'
      run.failureCode = 'user_cancelled'
      run.pendingApproval = undefined
      run.pendingInteraction = undefined
      run.error = undefined
      run.failureRawMessage = undefined
      run.updatedAt = now
      run.finishedAt = now
      run.finalAnswer = undefined
    } else if (event.type === 'run_warning') {
      run.updatedAt = now
    } else {
      run.updatedAt = now
    }

    if (entry) entry.run = run
    if (saveImmediately) {
      this.clearProjectionFlush(runId)
      await this.deps.aiRunStore.saveRun(run)
    }
  }

  private scheduleProjectionFlush(runId: string): void {
    const entry = this.activeRuns.get(runId)
    if (!entry || entry.projectionFlushTimer) return
    entry.projectionFlushTimer = setTimeout(() => {
      entry.projectionFlushTimer = null
      void this.deps.aiRunStore.saveRun(entry.run).catch((error) => {
        console.error('[CHAT-RUN] partial projection save failed:', error)
      })
    }, PARTIAL_SAVE_DELAY_MS)
  }

  private clearProjectionFlush(runId: string): void {
    const entry = this.activeRuns.get(runId)
    if (!entry?.projectionFlushTimer) return
    clearTimeout(entry.projectionFlushTimer)
    entry.projectionFlushTimer = null
  }

  private broadcastEvent(event: AiRunEvent): void {
    if (this.deps.broadcastEvent) {
      this.deps.broadcastEvent(event)
      return
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('ai-run-event', event)
      }
    })
  }
}
