import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { AiRunService } from './AiRunService'
import { buildConversationMemorySummary, CONVERSATION_MEMORY_BATCH_MESSAGES } from './memory'
import { releaseDocxRunSession } from './human/tools/docx/worker/docxWorkerClient'
import { normalizeSelectedReferences, normalizeWorkspaceBinding } from './utils/runContext'
import { validateSelectedReferencesForRun } from '../sourceScope/validation'
import { normalizeForIpc } from '../../utils/serialization'
import type { AiFileChangeService } from './fileChanges/AiFileChangeService'
import type { DocxApplyService } from './human/tools/docx/review/DocxApplyService'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { ChatStore } from '../storage/domains/ChatStore'
import type { AiRunStore } from '../storage/domains/AiRunStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { AiRuntimeSettingsStore } from '../storage/domains/AiRuntimeSettingsStore'
import type { WorkspaceStore } from '../storage/domains/WorkspaceStore'
import type { WebSourceStore } from '../storage/domains/WebSourceStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { BrowserEmbedService } from '../browser/BrowserEmbedService'
import type { WebCrawlerService } from '../webCrawler/types'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AiArtifactRef,
  AiLlmIoRecord,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  AiRunCancelResponse,
  AiRunEvent,
  AiRunRecord,
  ChatRunEventsResponse,
  ChatMessage,
  ChatSessionOpenResponse,
  ChatSessionRunSummariesResponse,
  ChatSessionSnapshotResponse,
  ChatTurnRetractLatestRequest,
  ChatTurnRetractLatestResponse,
  ChatSubmitRequest,
  ChatSubmitResponse
} from '../../../shared/types'

type ConversationMemorySummaryBuilder = typeof buildConversationMemorySummary

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

type ActiveRun = {
  run: AiRunRecord
  cancelled: boolean
  deleted: boolean
  abortController: AbortController
  eventQueue: Promise<void>
  projectionFlushTimer: ReturnType<typeof setTimeout> | null
}

type ChatRunServiceDeps = {
  chatStore: ChatStore
  aiRunStore: AiRunStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  llmStore: LlmConfigStore
  aiRuntimeSettingsStore: AiRuntimeSettingsStore
  workspaceStore: WorkspaceStore
  webSourceStore: WebSourceStore
  ensureEmbeddingReady: () => Promise<void>
  docxApplyService: DocxApplyService
  aiFileChangeService: AiFileChangeService
  browserUseService?: BrowserEmbedService
  webCrawlerService?: WebCrawlerService
  recordLlmIo?: (record: AiLlmIoRecord) => void
  broadcastEvent?: (event: AiRunEvent) => void
  autoStartRuns?: boolean
  conversationMemorySummaryBuilder?: ConversationMemorySummaryBuilder
}

const jieba = Jieba.withDict(dict)
const ACTIVE_RUN_STATUSES: AiRunRecord['status'][] = ['running', 'waiting_approval']
const INTERRUPTED_RUN_MESSAGE = '运行已中断，请重新发送消息。'
const PARTIAL_SAVE_DELAY_MS = 500

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const appendArtifact = (artifacts: AiArtifactRef[] | undefined, artifact: AiArtifactRef) => {
  const current = artifacts || []
  const key = `${artifact.kind}:${artifact.path}:${artifact.applyId || ''}`
  if (current.some((item) => `${item.kind}:${item.path}:${item.applyId || ''}` === key)) {
    return current
  }
  return [...current, artifact]
}

const isSnapshotEvent = (event: AiRunEvent): boolean =>
  event.type !== 'answer_token' && event.type !== 'llm_stream_delta'

export class ChatRunService {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly activeApprovals = new Map<string, ActiveApproval>()
  private readonly conversationMemoryJobs = new Map<string, Promise<void>>()

  public constructor(private readonly deps: ChatRunServiceDeps) {}

  public async failInterruptedRuns(): Promise<void> {
    const interrupted = await this.deps.aiRunStore.listRunsByStatuses(ACTIVE_RUN_STATUSES)
    for (const run of interrupted) {
      const now = Date.now()
      const nextRun: AiRunRecord = {
        ...run,
        status: 'failed',
        error: INTERRUPTED_RUN_MESSAGE,
        partialAnswer: run.partialAnswer || INTERRUPTED_RUN_MESSAGE,
        finalAnswer: run.finalAnswer || INTERRUPTED_RUN_MESSAGE,
        pendingApproval: undefined,
        updatedAt: now,
        finishedAt: now
      }
      await this.deps.aiRunStore.saveRun(nextRun)
      await this.deps.chatStore.saveChatMessage({
        id: run.assistantMessageId,
        session_id: run.sessionId,
        role: 'assistant',
        content: nextRun.finalAnswer || INTERRUPTED_RUN_MESSAGE,
        timestamp: now,
        artifacts: nextRun.artifacts,
        error: true
      })
      await this.deps.aiRunStore.appendEvent({
        runId: run.id,
        sessionId: run.sessionId,
        event: {
          type: 'run_failed',
          runId: run.id,
          error: INTERRUPTED_RUN_MESSAGE,
          code: 'error'
        }
      })
    }
  }

  public async getSessionSnapshot(sessionId: string): Promise<ChatSessionSnapshotResponse> {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return { messages: [], runs: [], activeRuns: [] }
    const messages = await this.deps.chatStore.getChatMessages(normalizedSessionId)
    const messageIds = new Set(messages.map((message) => message.id))
    const runs = (await this.deps.aiRunStore.listRunsBySession(normalizedSessionId)).filter((run) =>
      messageIds.has(run.assistantMessageId)
    )
    const runSnapshots = await Promise.all(runs.map((run) => this.buildRunSnapshot(run)))
    const activeRuns = runSnapshots.filter((snapshot) =>
      ACTIVE_RUN_STATUSES.includes(snapshot.run.status)
    )
    return { messages, runs: runSnapshots, activeRuns }
  }

  public async openSession(input: {
    sessionId: string
    limit?: number
    beforeTimestamp?: number
  }): Promise<ChatSessionOpenResponse> {
    const startedAt = Date.now()
    const normalizedSessionId = String(input.sessionId || '').trim()
    if (!normalizedSessionId) return { messages: [], hasMoreBefore: false, activeRuns: [] }
    const [session, page, activeRunRecords] = await Promise.all([
      this.deps.chatStore.getChatSession(normalizedSessionId),
      this.deps.chatStore.getChatMessagesPage({
        sessionId: normalizedSessionId,
        limit: input.limit || 50,
        beforeTimestamp: input.beforeTimestamp
      }),
      this.deps.aiRunStore.listRunsBySession(normalizedSessionId, ACTIVE_RUN_STATUSES)
    ])
    const activeRuns = await Promise.all(activeRunRecords.map((run) => this.buildRunSnapshot(run)))
    const response = {
      session: session || undefined,
      messages: page.messages,
      hasMoreBefore: page.hasMoreBefore,
      activeRuns
    }
    this.logSlowChatQuery('chat-session-open', startedAt, {
      sessionId: normalizedSessionId,
      messages: response.messages.length,
      activeRuns: response.activeRuns.length
    })
    return response
  }

  public async getSessionRunSummaries(sessionId: string): Promise<ChatSessionRunSummariesResponse> {
    const startedAt = Date.now()
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return { runs: [] }
    const recentMessages = await this.deps.chatStore.getRecentChatMessages(normalizedSessionId, 50)
    const recentMessageIds = recentMessages.map((message) => message.id)
    const runs = await this.deps.aiRunStore.listRunsByMessageIds(
      normalizedSessionId,
      recentMessageIds
    )
    const response = {
      runs: await Promise.all(runs.map((run) => this.buildRunSnapshot(run, false)))
    }
    this.logSlowChatQuery('chat-session-run-summaries', startedAt, {
      sessionId: normalizedSessionId,
      runs: response.runs.length
    })
    return response
  }

  public async getRunEvents(runId: string): Promise<ChatRunEventsResponse> {
    const startedAt = Date.now()
    const normalizedRunId = String(runId || '').trim()
    if (!normalizedRunId) return { events: [] }
    const events = (await this.deps.aiRunStore.listEvents(normalizedRunId))
      .map((record) => record.event)
      .filter(isSnapshotEvent)
    this.logSlowChatQuery('chat-run-events-get', startedAt, {
      runId: normalizedRunId,
      events: events.length
    })
    return { events }
  }

  public async retractLatestTurn(
    payload: ChatTurnRetractLatestRequest
  ): Promise<ChatTurnRetractLatestResponse> {
    const sessionId = String(payload?.sessionId || '').trim()
    const userMessageId = String(payload?.userMessageId || '').trim()
    if (!sessionId || !userMessageId) {
      return { success: false, messages: [], error: 'sessionId and userMessageId are required' }
    }
    const activeRuns = Array.from(this.activeRuns.values()).filter(
      (entry) => entry.run.sessionId === sessionId
    )
    if (activeRuns.length > 0) {
      return { success: false, messages: [], error: '当前会话仍在运行，不能编辑消息' }
    }

    const messages = await this.deps.chatStore.getChatMessages(sessionId)
    const targetIndex = messages.findIndex((message) => message.id === userMessageId)
    const target = targetIndex >= 0 ? messages[targetIndex] : null
    if (!target || target.role !== 'user') {
      return { success: false, messages, error: '只能撤回用户消息' }
    }
    const latestUser = [...messages].reverse().find((message) => message.role === 'user')
    if (latestUser?.id !== target.id) {
      return { success: false, messages, error: '只能编辑最新一条用户消息' }
    }

    const following = messages.slice(targetIndex + 1)
    if (following.some((message) => message.role === 'user')) {
      return { success: false, messages, error: '只能撤回最后一轮对话' }
    }
    const assistantMessage = following.find((message) => message.role === 'assistant')
    const runs = await this.deps.aiRunStore.listRunsBySession(sessionId)
    const run = runs.find(
      (item) =>
        item.userMessageId === target.id ||
        (assistantMessage ? item.assistantMessageId === assistantMessage.id : false)
    )
    const messageIdsToDelete = [
      target.id,
      ...following
        .filter((message) => !run || message.id === run.assistantMessageId)
        .map((message) => message.id)
    ]

    const memory = await this.deps.chatStore.getConversationMemory(sessionId)
    const memoryCleared =
      Boolean(memory?.coveredTimestamp && target.timestamp <= Number(memory.coveredTimestamp)) ||
      Boolean(memory?.coveredMessageId && messageIdsToDelete.includes(memory.coveredMessageId))

    await this.deps.chatStore.deleteChatMessagesByIds(messageIdsToDelete)
    if (run) {
      await this.deps.aiRunStore.deleteRunsByIds([run.id])
    }
    if (memoryCleared) {
      await this.deps.chatStore.clearConversationMemory(sessionId)
    }
    const nextMessages = await this.deps.chatStore.getChatMessages(sessionId)

    return {
      success: true,
      userMessage: target,
      assistantMessageId: assistantMessage?.id,
      runId: run?.id,
      messages: nextMessages,
      memoryCleared
    }
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return

    const affectedRuns = Array.from(this.activeRuns.entries()).filter(
      ([, entry]) => entry.run.sessionId === normalizedSessionId
    )
    for (const [runId, entry] of affectedRuns) {
      entry.cancelled = true
      entry.deleted = true
      entry.abortController.abort()
      this.clearProjectionFlush(runId)
      const approval = this.activeApprovals.get(runId)
      approval?.resolve({ accepted: false, error: '当前会话已删除' })
      this.activeApprovals.delete(runId)
    }

    await Promise.all(affectedRuns.map(([, entry]) => entry.eventQueue.catch(() => {})))
    await this.deps.chatStore.deleteChatSession(normalizedSessionId)
    await this.deps.aiRunStore.deleteRunsBySession(normalizedSessionId)
  }

  public async submit(payload: ChatSubmitRequest): Promise<ChatSubmitResponse> {
    const mode = payload?.mode === 'search' ? 'search' : 'ai'
    const sessionId = String(payload?.sessionId || '').trim()
    const input = String(payload?.input || '').trim()
    if (!sessionId) return { success: false, error: 'sessionId is required' }
    if (!input) return { success: false, error: 'input is required' }
    if (mode === 'search') return await this.submitSearch({ ...payload, mode, sessionId, input })
    return await this.submitAi({ ...payload, mode, sessionId, input })
  }

  public async cancelRun(runId: string): Promise<AiRunCancelResponse> {
    const normalizedRunId = String(runId || '').trim()
    const entry = this.activeRuns.get(normalizedRunId)
    if (!entry) return { success: false, error: '当前运行已结束' }
    entry.cancelled = true
    entry.abortController.abort()
    const approval = this.activeApprovals.get(normalizedRunId)
    approval?.resolve({ accepted: false, error: '已取消' })
    this.activeApprovals.delete(normalizedRunId)
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
      request: payload,
      event: decisionEvent
    })
    if (!persisted.ok) return { success: false, error: persisted.error || 'approval failed' }

    const entry = this.activeRuns.get(runId)
    if (entry) {
      entry.run = {
        ...entry.run,
        ...(persisted.run || {}),
        status: 'running',
        pendingApproval: undefined
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

  private async buildRunSnapshot(run: AiRunRecord, loadEventsFallback = true) {
    const processEvents = (run.processEvents || []).filter(isSnapshotEvent)
    const events =
      processEvents.length > 0 || !loadEventsFallback
        ? processEvents
        : (await this.deps.aiRunStore.listEvents(run.id))
            .map((record) => record.event)
            .filter(isSnapshotEvent)
    return {
      run: {
        ...run,
        processEvents: events,
        eventCount: run.eventCount ?? events.length,
        visibleEventCount: run.visibleEventCount ?? events.length
      },
      events,
      pendingApproval: run.pendingApproval
    }
  }

  private appendProcessEvent(run: AiRunRecord, event: AiRunEvent, now: number): void {
    if (!isSnapshotEvent(event)) return
    run.eventCount = (run.eventCount || 0) + 1
    run.visibleEventCount = (run.visibleEventCount || 0) + 1
    run.lastEventAt = now
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

  private async submitSearch(
    payload: ChatSubmitRequest & { mode: 'search'; sessionId: string; input: string }
  ): Promise<ChatSubmitResponse> {
    const createdAt = Date.now()
    const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
    const userMessage: ChatMessage = {
      id: uuidv4(),
      session_id: payload.sessionId,
      role: 'user',
      content: payload.input,
      timestamp: createdAt,
      contentNodes: payload.contentNodes,
      selectedReferences: normalizedReferences,
      attachments
    }
    await this.saveUserMessageAndTitle(userMessage)

    const { data: queryVector } = await this.deps.embeddingService.embed(payload.input)
    const documentIds = Array.isArray(payload.searchDocumentIds)
      ? payload.searchDocumentIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined
    const results = await this.deps.documentsStore.search(
      queryVector,
      payload.input,
      5,
      undefined,
      undefined,
      documentIds
    )
    const tokens = jieba.cutForSearch(payload.input, true)
    const normalizedResults = results.map(normalizeForIpc)
    const content =
      normalizedResults.length > 0
        ? `已在当前资料范围中找到 ${normalizedResults.length} 条结果，右侧可以直接查看命中详情。`
        : '未在当前资料范围中找到匹配结果。'
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      session_id: payload.sessionId,
      role: 'assistant',
      content,
      timestamp: Date.now()
    }
    await this.deps.chatStore.saveChatMessage(assistantMessage)

    return {
      success: true,
      mode: 'search',
      userMessage,
      assistantMessage,
      results: normalizedResults,
      tokens,
      content
    }
  }

  private async submitAi(
    payload: ChatSubmitRequest & { mode: 'ai'; sessionId: string; input: string }
  ): Promise<ChatSubmitResponse> {
    const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
    const normalizedWorkspace = normalizeWorkspaceBinding(payload.workspace)
    const modelName = String(payload.modelName || '').trim()
    if (!modelName) {
      return {
        success: false,
        error: '当前配置未获取到可用模型，请先在「大模型」中打开模型列表获取模型'
      }
    }
    if (!normalizedWorkspace) {
      return { success: false, error: 'AI 运行必须绑定工作区，当前请求缺少工作区信息。' }
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
      session_id: payload.sessionId,
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
      session_id: payload.sessionId,
      role: 'assistant',
      content: '',
      timestamp: createdAt + 1
    }
    const run: AiRunRecord = {
      id: runId,
      sessionId: payload.sessionId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      status: 'running',
      input: payload.input,
      selectedReferences: normalizedReferences,
      attachments,
      workspace: normalizedWorkspace,
      modelName,
      partialAnswer: '',
      artifacts: [],
      processEvents: [],
      eventCount: 0,
      visibleEventCount: 0,
      createdAt,
      updatedAt: createdAt
    }

    await this.saveUserMessageAndTitle(userMessage)
    await this.deps.chatStore.saveChatMessage(assistantMessage)
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
      mode: 'ai',
      userMessage,
      assistantMessage,
      run
    }
  }

  private async saveUserMessageAndTitle(userMessage: ChatMessage): Promise<void> {
    const existingMessages = await this.deps.chatStore.getChatMessages(userMessage.session_id)
    await this.deps.chatStore.saveChatMessage(userMessage)
    if (existingMessages.length !== 0) return
    const sessions = await this.deps.chatStore.getChatSessions()
    const session = sessions.find((item) => item.id === userMessage.session_id)
    if (!session) return
    await this.deps.chatStore.saveChatSession({
      ...session,
      title: userMessage.content.slice(0, 20)
    })
  }

  private async startAiRun(runId: string): Promise<void> {
    const entry = this.activeRuns.get(runId)
    if (!entry) return
    const { run } = entry
    const sendEvent = (event: AiRunEvent): void => {
      void this.queueRunEvent(runId, event)
    }

    await this.queueRunEvent(runId, {
      type: 'run_started',
      runId,
      sessionId: run.sessionId,
      createdAt: Date.now(),
      input: run.input
    })
    this.deps.docxApplyService.beginRun({
      runId,
      sessionId: run.sessionId,
      inputText: run.input
    })

    try {
      const runtimeSettings = await this.deps.aiRuntimeSettingsStore.get()
      const result = await AiRunService.getInstance().run(
        {
          runId,
          sessionId: run.sessionId,
          input: run.input,
          selectedReferences: run.selectedReferences,
          attachments: run.attachments,
          modelName: run.modelName,
          workspace: run.workspace
        },
        {
          runtimeSettings,
          llmStore: this.deps.llmStore,
          chatStore: this.deps.chatStore,
          documentsStore: this.deps.documentsStore,
          embeddingService: this.deps.embeddingService,
          ensureEmbeddingReady: this.deps.ensureEmbeddingReady,
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
          browserUseService: this.deps.browserUseService,
          webCrawlerService: this.deps.webCrawlerService
        }
      )

      await this.flushRunEvents(runId)
      if (result.status === 'cancelled') {
        this.deps.docxApplyService.discardRun(runId)
        await this.queueRunEvent(runId, { type: 'run_cancelled', runId })
        return
      }

      if (result.status === 'failed') {
        this.deps.docxApplyService.discardRun(runId)
        await this.queueRunEvent(runId, {
          type: 'run_failed',
          runId,
          error: result.error || 'failed',
          code: result.failureCode,
          resumeSnapshotSaved: result.resumeSnapshotSaved
        })
        return
      }

      await this.flushRunEvents(runId)
      await this.queueRunEvent(runId, { type: 'run_completed', runId })
      this.scheduleConversationMemoryUpdate({
        runId,
        sessionId: run.sessionId,
        runtimeSettings,
        modelName: run.modelName || '',
        sendEvent
      })
    } catch (error) {
      this.deps.docxApplyService.discardRun(runId)
      if (this.activeRuns.get(runId)?.cancelled) {
        await this.queueRunEvent(runId, { type: 'run_cancelled', runId })
        return
      }
      await this.queueRunEvent(runId, {
        type: 'run_failed',
        runId,
        error: getErrorMessage(error),
        code: 'error'
      })
    } finally {
      await releaseDocxRunSession(runId)
      const approval = this.activeApprovals.get(runId)
      approval?.resolve({ accepted: false, error: 'run closed' })
      this.activeApprovals.delete(runId)
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
    if (this.activeApprovals.has(runId)) {
      return { accepted: false, error: 'approval batch already pending' }
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

  private scheduleConversationMemoryUpdate(input: {
    runId: string
    sessionId: string
    runtimeSettings: Awaited<ReturnType<AiRuntimeSettingsStore['get']>>
    modelName: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<void> | null {
    const sessionId = String(input.sessionId || '').trim()
    if (!sessionId || this.conversationMemoryJobs.has(sessionId)) return null

    const job = this.runConversationMemoryJob(input)
      .catch((error) => {
        console.error('[CONVERSATION-MEMORY] background update failed:', error)
      })
      .finally(() => {
        if (this.conversationMemoryJobs.get(sessionId) === job) {
          this.conversationMemoryJobs.delete(sessionId)
        }
      })
    this.conversationMemoryJobs.set(sessionId, job)
    return job
  }

  private isSameConversationMemoryPoint(
    left: Awaited<ReturnType<ChatStore['getConversationMemory']>>,
    right: Awaited<ReturnType<ChatStore['getConversationMemory']>>
  ): boolean {
    if (Boolean(left) !== Boolean(right)) return false
    return (
      (left?.coveredMessageId || null) === (right?.coveredMessageId || null) &&
      (left?.coveredTimestamp || null) === (right?.coveredTimestamp || null) &&
      (left?.coveredMessageCount || 0) === (right?.coveredMessageCount || 0)
    )
  }

  private async runConversationMemoryJob(input: {
    runId: string
    sessionId: string
    runtimeSettings: Awaited<ReturnType<AiRuntimeSettingsStore['get']>>
    modelName: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<void> {
    for (;;) {
      const batch = await this.deps.chatStore.getNextConversationMemoryBatch({
        sessionId: input.sessionId,
        batchSize: CONVERSATION_MEMORY_BATCH_MESSAGES
      })
      if (batch.batch.length < CONVERSATION_MEMORY_BATCH_MESSAGES) return

      const startMemory = batch.memory
      const summaryBuilder =
        this.deps.conversationMemorySummaryBuilder || buildConversationMemorySummary
      const summary = await summaryBuilder({
        runId: input.runId,
        sessionId: input.sessionId,
        previousSummary: startMemory?.summary || '',
        messages: batch.batch,
        runtimeSettings: input.runtimeSettings,
        llmStore: this.deps.llmStore,
        modelName: input.modelName,
        sendEvent: input.sendEvent,
        recordLlmIo: this.deps.recordLlmIo
      })
      if (!summary) return

      const currentMemory = await this.deps.chatStore.getConversationMemory(input.sessionId)
      if (!this.isSameConversationMemoryPoint(startMemory, currentMemory)) {
        continue
      }
      const currentMessages = await this.deps.chatStore.getChatMessages(input.sessionId)
      const currentMessageIds = new Set(currentMessages.map((message) => message.id))
      if (!batch.batch.every((message) => currentMessageIds.has(message.id))) {
        continue
      }

      await this.deps.chatStore.saveConversationMemory(input.sessionId, {
        summary,
        coveredMessageId: batch.targetCoveredMessageId,
        coveredTimestamp: batch.targetCoveredTimestamp,
        coveredMessageCount: batch.targetCoveredMessageCount,
        updatedAt: Date.now()
      })
    }
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
    await this.deps.aiRunStore.appendEvent({
      runId,
      sessionId: run.sessionId,
      event
    })
    await this.projectEvent(runId, run, event)
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
    let saveImmediately = event.type !== 'answer_token'
    let assistantMessage: ChatMessage | null = null

    this.appendProcessEvent(run, event, now)

    if (event.type === 'answer_token') {
      run.partialAnswer = `${run.partialAnswer || ''}${event.token}`
      run.updatedAt = now
      assistantMessage = this.buildAssistantMessage(run, run.partialAnswer)
      this.scheduleProjectionFlush(runId)
    } else if (event.type === 'answer_completed') {
      run.partialAnswer = event.text
      run.finalAnswer = event.text
      run.updatedAt = now
      assistantMessage = this.buildAssistantMessage(run, event.text)
    } else if (event.type === 'file_artifact') {
      run.artifacts = appendArtifact(run.artifacts, {
        kind: 'file',
        capability: event.capability,
        path: event.path,
        fileName: event.fileName,
        operation: event.operation,
        applyId: event.applyId,
        summary: event.summary
      })
      run.updatedAt = now
      assistantMessage = this.buildAssistantMessage(run, run.finalAnswer || run.partialAnswer)
    } else if (event.type === 'approval_batch_required') {
      run.status = 'waiting_approval'
      run.pendingApproval = event
      run.updatedAt = now
    } else if (event.type === 'approval_batch_decision') {
      run.status = 'running'
      run.pendingApproval = undefined
      run.updatedAt = now
    } else if (event.type === 'run_completed') {
      run.status = run.status === 'failed' || run.status === 'cancelled' ? run.status : 'completed'
      run.pendingApproval = undefined
      run.updatedAt = now
      run.finishedAt = now
      assistantMessage = this.buildAssistantMessage(run, run.finalAnswer || run.partialAnswer)
    } else if (event.type === 'run_failed') {
      run.status = 'failed'
      run.pendingApproval = undefined
      run.error = event.error
      run.updatedAt = now
      run.finishedAt = now
      const content = run.partialAnswer
        ? `${run.partialAnswer}\n\n**[失败]** ${event.error}`
        : `**[失败]** ${event.error}`
      assistantMessage = this.buildAssistantMessage(run, content, true)
    } else if (event.type === 'run_cancelled') {
      run.status = 'cancelled'
      run.pendingApproval = undefined
      run.error = '已取消'
      run.updatedAt = now
      run.finishedAt = now
      const content = run.partialAnswer ? `${run.partialAnswer}\n\n**[已取消]**` : '**[已取消]**'
      assistantMessage = this.buildAssistantMessage(run, content, true)
    } else if (
      !event.internal &&
      (event.type === 'runtime_issue' || event.type === 'workspace_required')
    ) {
      run.status = 'failed'
      run.error = event.type === 'runtime_issue' ? event.message : event.reason
      run.updatedAt = now
      saveImmediately = true
    } else {
      run.updatedAt = now
    }

    if (entry) entry.run = run
    if (assistantMessage) await this.deps.chatStore.saveChatMessage(assistantMessage)
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

  private buildAssistantMessage(run: AiRunRecord, content: string, error = false): ChatMessage {
    return {
      id: run.assistantMessageId,
      session_id: run.sessionId,
      role: 'assistant',
      content,
      timestamp: run.createdAt + 1,
      artifacts: run.artifacts && run.artifacts.length > 0 ? run.artifacts : undefined,
      error
    }
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
