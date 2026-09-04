import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { AiRunService } from '../../../../../src/main/services/ai/AiRunService'
import { AiRunResourceManager } from '../../../../../src/main/services/ai/run/AiRunResourceManager'
import { createCompletedAiRunState } from '../../../../../src/main/services/ai/run/state'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { StorageService } from '../../../../../src/main/services/storage/StorageService'
import type { EmbeddingService } from '../../../../../src/main/services/vector/EmbeddingService'
import type {
  AiRunEvent,
  AiRunRecord,
  ChatMessage,
  ChatSession
} from '../../../../../src/shared/types'

type TestService = {
  workspaceRoot: string
  storage: StorageService
  service: ChatRunService
  events: AiRunEvent[]
}

type ChatRunServicePrivate = ChatRunService & {
  queueRunEvent: (runId: string, event: AiRunEvent) => Promise<void>
  requestApprovalBatch: (
    runId: string,
    request: {
      taskId: string
      batchId: string
      items: Array<{ itemId: string; title: string; description: string }>
    }
  ) => Promise<
    | { accepted: true; decisions: Array<{ itemId: string; action: 'approve' | 'reject' | 'guide' }> }
    | { accepted: false; error: string }
  >
}

const tempRoots: string[] = []
const activeStorages: StorageService[] = []

const waitForCondition = async (
  check: () => Promise<boolean> | boolean,
  timeoutMs = 5000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
}

const createTestService = async (options?: {
  autoStartRuns?: boolean
  onRunTerminal?: (run: AiRunRecord, status: 'completed' | 'failed' | 'cancelled') => void
}): Promise<TestService> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncurator-chat-run-'))
  const workspaceRoot = path.join(root, 'workspace')
  await mkdir(workspaceRoot)
  tempRoots.push(root)
  const storage = new StorageService({
    dbPath: path.join(root, 'lancedb')
  })
  await storage.initialize()
  activeStorages.push(storage)
  const aiFileChangeService = new AiFileChangeService(storage.aiFileChange)
  const docxApplyService = new DocxApplyService(storage.docxApply, aiFileChangeService)
  const embeddingService = {
    embed: async () => ({ data: new Float32Array(768) })
  } as EmbeddingService
  const events: AiRunEvent[] = []
  const service = new ChatRunService({
    chatStore: storage.chat,
    chatMessageLogStore: storage.chatMessageLog,
    chatSearchTurnStore: storage.chatSearchTurn,
    aiRunStore: storage.aiRun,
    documentsStore: storage.documents,
    embeddingService,
    llmStore: storage.llm,
    aiRuntimeSettingsStore: storage.aiRuntimeSettings,
    workspaceStore: storage.workspace,
    webSourceStore: storage.webSource,
    ensureEmbeddingReady: async () => await new Promise<never>(() => {}),
    docxApplyService,
    aiFileChangeService,
    runResourceManager: new AiRunResourceManager(),
    broadcastEvent: (event) => {
      events.push(event)
    },
    autoStartRuns: options?.autoStartRuns ?? false,
    onRunTerminal: options?.onRunTerminal
  })
  return { workspaceRoot, storage, service, events }
}

const seedSession = async (storage: StorageService): Promise<ChatSession> => {
  const session: ChatSession = {
    id: 'session-1',
    title: '新对话',
    created_at: Date.now(),
    workspace_id: 'workspace-1',
    pinned: false,
    pinned_at: null
  }
  await storage.chat.saveChatSession(session)
  return session
}

const buildWorkspace = (workspaceRoot: string) => ({
  workspaceId: 'workspace-1',
  workspaceName: 'workspace-1',
  rootPath: workspaceRoot
})

const seedAiTurn = async (
  storage: StorageService,
  workspaceRoot: string,
  turn: {
    runId: string
    userMessageId: string
    assistantMessageId: string
    userContent: string
    assistantContent?: string
    status?: AiRunRecord['status']
    partialAnswer?: string
    finalAnswer?: string
    artifacts?: AiRunRecord['artifacts']
    createdAt: number
    error?: string
    failureCode?: AiRunRecord['failureCode']
  }
): Promise<void> => {
  const assistantContent = turn.assistantContent ?? turn.finalAnswer ?? turn.partialAnswer ?? ''
  await storage.aiRun.saveRun({
    id: turn.runId,
    sessionId: 'session-1',
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
    status: turn.status ?? 'completed',
    input: turn.userContent,
    partialAnswer: turn.partialAnswer ?? assistantContent,
    finalAnswer: turn.finalAnswer ?? assistantContent,
    artifacts: turn.artifacts,
    workspace: buildWorkspace(workspaceRoot),
    modelName: 'mock-model',
    mainModel: { configId: 'mock-config', modelName: 'mock-model' },
    preference: 'local_sources_strict',
    executionPermission: 'review',
    error: turn.error,
    failureCode: turn.failureCode,
    createdAt: turn.createdAt,
    updatedAt: turn.createdAt + 1,
    finishedAt: turn.status === 'running' ? undefined : turn.createdAt + 1
  })
}

const listSessionMessages = async (
  service: ChatRunService,
  sessionId: string
): Promise<ChatMessage[]> => await service.listSessionMessages(sessionId)

const submitAiRun = async (
  { workspaceRoot, storage, service }: TestService,
  executionPermission: 'review' | 'full_access' = 'review'
) => {
  await seedSession(storage)
  const response = await service.submit({
    mode: 'ai',
    preference: 'local_sources_strict',
    executionPermission,
    sessionId: 'session-1',
    input: '生成测试回答',
    mainModel: {
      configId: 'mock-config',
      modelName: 'mock-model'
    },
    workspace: {
      workspaceId: 'workspace-1',
      workspaceName: 'workspace-1',
      rootPath: workspaceRoot
    }
  })
  expect(response.success).toBe(true)
  expect(response.run).toBeTruthy()
  return response.run as AiRunRecord
}

afterEach(async () => {
  await Promise.all(activeStorages.splice(0).map((storage) => storage.close()))
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('unit ai persistence backend', () => {
  it('chat-submit-ai-creates-placeholder-and-run', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)

    const messages = await listSessionMessages(setup.service, 'session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1].content).toBe('')
    expect(storedRun?.status).toBe('running')
    expect(storedRun?.assistantMessageId).toBe(messages[1].id)
    expect(run.preference).toBe('local_sources_strict')
    expect(run.executionPermission).toBe('review')
    expect(storedRun?.executionPermission).toBe('review')
  })

  it('full-access-run-skips-approval-event-and-returns-approve-decisions', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup, 'full_access')
    const service = setup.service as ChatRunServicePrivate

    const result = await service.requestApprovalBatch(run.id, {
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [{ itemId: 'item-1', title: '创建文件', description: '创建测试文件' }]
    })

    expect(result).toEqual({
      accepted: true,
      decisions: [{ itemId: 'item-1', action: 'approve' }]
    })
    expect(setup.events.some((event) => event.type === 'approval_batch_required')).toBe(false)
    const storedRun = await setup.storage.aiRun.getRun(run.id)
    expect(storedRun?.executionPermission).toBe('full_access')
    expect(storedRun?.status).toBe('running')
  })

  it('review-run-keeps-approval-event-and-waiting-state', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    const approvalPromise = service.requestApprovalBatch(run.id, {
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [{ itemId: 'item-1', title: '创建文件', description: '创建测试文件' }]
    })

    await waitForCondition(() =>
      setup.events.some((event) => event.type === 'approval_batch_required')
    )
    expect((await setup.storage.aiRun.getRun(run.id))?.status).toBe('waiting_approval')
    await setup.service.decideApprovalBatch({
      runId: run.id,
      batchId: 'batch-1',
      decisions: [{ itemId: 'item-1', action: 'approve' }]
    })
    await expect(approvalPromise).resolves.toMatchObject({ accepted: true })
  })

  it('run-events-update-assistant-message-and-run', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate

    await service.queueRunEvent(run.id, {
      type: 'answer_token',
      runId: run.id,
      token: 'Hello'
    })
    await service.queueRunEvent(run.id, {
      type: 'answer_completed',
      runId: run.id,
      text: 'Hello world'
    })
    await service.queueRunEvent(run.id, {
      type: 'run_completed',
      runId: run.id
    })

    const messages = await listSessionMessages(setup.service, 'session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)

    expect(messages[1].content).toBe('Hello world')
    expect(storedRun?.status).toBe('completed')
    expect(storedRun?.finalAnswer).toBe('Hello world')
    expect(setup.events.map((event) => event.type)).toContain('answer_completed')
    expect(setup.events.map((event) => event.type)).toContain('run_completed')
  })

  it('notifies the terminal callback after the run is persisted', async () => {
    const terminalRuns: Array<{ run: AiRunRecord; status: string }> = []
    const setup = await createTestService({
      onRunTerminal: (run, status) => terminalRuns.push({ run, status })
    })
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate

    await service.queueRunEvent(run.id, {
      type: 'run_failed',
      runId: run.id,
      source: 'internal',
      message: '失败'
    })

    expect(terminalRuns).toHaveLength(1)
    expect(terminalRuns[0].status).toBe('failed')
    expect((await setup.storage.aiRun.getRun(run.id))?.status).toBe('failed')
  })

  it.each([
    {
      name: 'failed',
      terminalEvent: (runId: string): AiRunEvent => ({
        type: 'run_failed',
        runId,
        source: 'internal',
        message: '模型连接中断'
      }),
      expectedContent: '草稿内容\n\n失败：模型连接中断'
    },
    {
      name: 'cancelled',
      terminalEvent: (runId: string): AiRunEvent => ({
        type: 'run_cancelled',
        runId
      }),
      expectedContent: '草稿内容\n\n已取消'
    }
  ])('keeps applied artifacts when a run is $name', async ({ terminalEvent, expectedContent }) => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    const filePath = path.join(setup.workspaceRoot, 'result.md')

    await service.queueRunEvent(run.id, {
      type: 'answer_token',
      runId: run.id,
      token: '草稿内容'
    })
    await service.queueRunEvent(run.id, {
      type: 'file_artifact',
      runId: run.id,
      taskId: run.id,
      artifactId: 'artifact-1',
      capability: 'text_file',
      path: filePath,
      fileName: 'result.md',
      operation: 'updated',
      applyId: 'change-1',
      createdAt: Date.now()
    })
    await service.queueRunEvent(run.id, terminalEvent(run.id))

    const messages = await listSessionMessages(setup.service, 'session-1')
    const assistantMessage = messages.find((message) => message.role === 'assistant')
    const storedRun = await setup.storage.aiRun.getRun(run.id)

    expect(assistantMessage?.content).toBe(expectedContent)
    expect(assistantMessage?.artifacts).toEqual([
      {
        kind: 'file',
        capability: 'text_file',
        path: filePath,
        fileName: 'result.md',
        operation: 'updated',
        applyId: 'change-1'
      }
    ])
    expect(storedRun?.artifacts).toEqual(assistantMessage?.artifacts)
  })

  it('autostart-run-emits-process-events-after-run-started', async () => {
    const previousTimeout = process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS
    process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS = '10'
    try {
      const setup = await createTestService({ autoStartRuns: true })
      const run = await submitAiRun(setup)

      await waitForCondition(() =>
        setup.events.some((event) => event.type === 'assistant_process_group_started')
      )
      await waitForCondition(() => setup.events.some((event) => event.type === 'run_failed'))

      const storedRun = await setup.storage.aiRun.getRun(run.id)

      expect(setup.events.map((event) => event.type)).toContain('run_started')
      expect(setup.events.map((event) => event.type)).toContain('assistant_process_group_started')
      expect(storedRun?.status).toBe('failed')
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS
      } else {
        process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS = previousTimeout
      }
    }
  })

  it('does-not-attribute-uncontrolled-workspace-changes-when-a-run-finishes', async () => {
    const setup = await createTestService({ autoStartRuns: true })
    const runner = vi.spyOn(AiRunService, 'getInstance').mockReturnValue({
      run: async (payload) => {
        await writeFile(path.join(setup.workspaceRoot, 'uncontrolled-change.txt'), 'external change')
        return createCompletedAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: payload.input,
          finalDeliveryMarkdown: '完成，但没有调用文件工具或终端。'
        })
      }
    } as unknown as AiRunService)
    try {
      const run = await submitAiRun(setup)
      await waitForCondition(() => setup.events.some((event) => event.type === 'run_completed'))

      const records = await setup.storage.aiFileChange.listRecords({
        sessionId: run.sessionId,
        runId: run.id
      })
      expect(await access(path.join(setup.workspaceRoot, 'uncontrolled-change.txt')).then(() => true)).toBe(true)
      expect(records.items).toEqual([])
      expect(setup.events.filter((event) => event.type === 'file_artifact')).toEqual([])
    } finally {
      runner.mockRestore()
    }
  })

  it('approval-required-is-restored-through-session-snapshot', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate

    await service.queueRunEvent(run.id, {
      type: 'approval_batch_required',
      runId: run.id,
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [
        {
          itemId: 'item-1',
          order: 1,
          toolName: 'terminal_run',
          command: 'echo hello',
          reason: '测试审批'
        }
      ],
      createdAt: Date.now()
    })

    const snapshot = await setup.service.getSessionSnapshot('session-1')

    expect(snapshot.activeRuns[0].run.status).toBe('waiting_approval')
    expect(snapshot.activeRuns[0].pendingApproval?.batchId).toBe('batch-1')
  })

  it('session-open-returns-messages-and-active-runs-with-message-log', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: run.id,
      entries: [
        { kind: 'annotation', eventType: 'thinking_started', payload: {} },
        { kind: 'assistant', content: '先检索资料', toolCalls: [] },
        { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
      ]
    })
    const listRunsByMessageIdsSpy = vi.spyOn(setup.storage.aiRun, 'listRunsByMessageIds')

    const opened = await setup.service.openSession({ sessionId: 'session-1', limit: 50 })

    expect(opened.messages).toHaveLength(2)
    expect(opened.activeRuns).toHaveLength(1)
    expect(opened.activeRuns[0].messageLogRecords?.map((record) => record.entry.kind)).toEqual([
      'annotation',
      'assistant',
      'annotation'
    ])
    expect(listRunsByMessageIdsSpy).not.toHaveBeenCalled()
    listRunsByMessageIdsSpy.mockRestore()
  })

  it('completed-run-message-log-is-restored-through-session-snapshot', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: run.id,
      entries: [
        { kind: 'annotation', eventType: 'thinking_started', payload: {} },
        { kind: 'assistant', content: '先检索资料', toolCalls: [] },
        { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
      ]
    })

    await service.queueRunEvent(run.id, {
      type: 'answer_completed',
      runId: run.id,
      text: 'final'
    })
    await service.queueRunEvent(run.id, {
      type: 'run_completed',
      runId: run.id
    })

    const snapshot = await setup.service.getSessionSnapshot('session-1')

    expect(snapshot.activeRuns).toEqual([])
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.runs?.[0].run.status).toBe('completed')
    expect(snapshot.runs?.[0].messageLogRecords).toHaveLength(3)
    expect(snapshot.runs?.[0].messageLogRecords?.[1].entry).toMatchObject({
      kind: 'assistant',
      content: '先检索资料'
    })
  })

  it('completed-run-message-log-is-restored-through-run-summaries', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: run.id,
      entries: [
        { kind: 'annotation', eventType: 'thinking_started', payload: {} },
        { kind: 'assistant', content: '先检索资料', toolCalls: [] },
        { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
      ]
    })

    await service.queueRunEvent(run.id, {
      type: 'answer_completed',
      runId: run.id,
      text: 'final'
    })
    await service.queueRunEvent(run.id, {
      type: 'run_completed',
      runId: run.id
    })

    const summaries = await setup.service.getSessionRunSummaries('session-1')

    expect(summaries.runs).toHaveLength(1)
    expect(summaries.runs[0].run.status).toBe('completed')
    expect(summaries.runs[0].messageLogRecords).toHaveLength(3)
    expect(summaries.runs[0].messageLogRecords?.[0].entry).toMatchObject({
      kind: 'annotation',
      eventType: 'thinking_started'
    })
  })

  it('startup-recovery-marks-interrupted-runs-failed', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const now = Date.now()
    await setup.storage.aiRun.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      input: '测试中断',
      partialAnswer: '',
      workspace: buildWorkspace(setup.workspaceRoot),
      modelName: 'mock-model',
      mainModel: { configId: 'mock-config', modelName: 'mock-model' },
      preference: 'local_sources_strict',
      executionPermission: 'review',
      createdAt: now,
      updatedAt: now
    })
    await setup.service.failInterruptedRuns()

    const storedRun = await setup.storage.aiRun.getRun('run-1')
    const messages = await listSessionMessages(setup.service, 'session-1')
    const assistantMessage = messages.find((message) => message.role === 'assistant')

    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.failureCode).toBe('process_interrupted')
    expect(storedRun?.error).toContain('运行已中断')
    expect(assistantMessage?.content).toContain('运行已中断')
    expect(assistantMessage?.error).toBe(true)
  })

  it('retract-latest-turn-guards-running-and-non-latest-user-message', async () => {
    const runningSetup = await createTestService()
    const runningRun = await submitAiRun(runningSetup)
    const runningMessages = await listSessionMessages(runningSetup.service, 'session-1')
    const runningResponse = await runningSetup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: runningRun.userMessageId
    })
    expect(runningResponse.success).toBe(false)
    expect(runningResponse.error).toContain('仍在运行')
    expect(await listSessionMessages(runningSetup.service, 'session-1')).toHaveLength(
      runningMessages.length
    )

    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    await seedAiTurn(setup.storage, setup.workspaceRoot, {
      runId: 'run-1',
      userMessageId: 'old-user',
      assistantMessageId: 'old-assistant',
      userContent: 'old',
      assistantContent: 'old reply',
      createdAt: baseTime
    })
    await seedAiTurn(setup.storage, setup.workspaceRoot, {
      runId: 'run-2',
      userMessageId: 'latest-user',
      assistantMessageId: 'latest-assistant',
      userContent: 'latest',
      assistantContent: 'latest reply',
      createdAt: baseTime + 2
    })

    const response = await setup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: 'old-user'
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('最新')
    expect(await listSessionMessages(setup.service, 'session-1')).toHaveLength(4)
  })

  it('retract-latest-turn-removes-user-assistant-run-and-its-message-log', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    await seedAiTurn(setup.storage, setup.workspaceRoot, {
      runId: 'kept-run',
      userMessageId: 'kept-user',
      assistantMessageId: 'kept-assistant',
      userContent: 'keep',
      assistantContent: 'kept reply',
      createdAt: baseTime
    })
    await seedAiTurn(setup.storage, setup.workspaceRoot, {
      runId: 'retract-run',
      userMessageId: 'retract-user',
      assistantMessageId: 'retract-assistant',
      userContent: 'retract me',
      assistantContent: 'done',
      createdAt: baseTime + 2
    })
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: 'retract-run',
      entries: [{ kind: 'annotation', eventType: 'thinking_started', payload: {} }]
    })

    const response = await setup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: 'retract-user'
    })

    expect(response.success).toBe(true)
    expect(response.userMessage?.id).toBe('retract-user')
    expect(response.assistantMessageId).toBe('retract-assistant')
    expect(response.runId).toBe('retract-run')
    expect(response.messages.map((message) => message.id)).toEqual(['kept-user', 'kept-assistant'])
    expect(await setup.storage.aiRun.getRun('retract-run')).toBeNull()
    expect(await setup.storage.chatMessageLog.listByRun('retract-run')).toEqual([])
  })

  it('retract-latest-turn-keeps-message-log-for-a-different-run', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    await seedAiTurn(setup.storage, setup.workspaceRoot, {
      runId: 'retract-run',
      userMessageId: 'retract-user',
      assistantMessageId: 'retract-assistant',
      userContent: 'replace this message',
      assistantContent: 'done',
      createdAt: baseTime
    })
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: 'newer-unfinished-run',
      entries: [{ kind: 'annotation', eventType: 'thinking_started', payload: {} }]
    })

    const response = await setup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: 'retract-user'
    })

    expect(response.success).toBe(true)
    expect(await setup.storage.chatMessageLog.listByRun('newer-unfinished-run')).toHaveLength(1)
  })

  it('delete-session-cleans-run-and-message-log-records', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    await setup.storage.chatMessageLog.appendBatch({
      sessionId: 'session-1',
      runId: run.id,
      entries: [{ kind: 'annotation', eventType: 'thinking_started', payload: {} }]
    })

    await setup.service.deleteSession('session-1')

    const sessions = await setup.storage.chat.getChatSessions()
    const messages = await listSessionMessages(setup.service, 'session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)
    const messageLog = await setup.storage.chatMessageLog.list('session-1')

    expect(sessions).toEqual([])
    expect(messages).toEqual([])
    expect(storedRun).toBeNull()
    expect(messageLog).toEqual([])
  })

  it('rejects-submit-when-session-already-used-the-other-mode', async () => {
    const setup = await createTestService({ autoStartRuns: false })
    await submitAiRun(setup)
    const searchAfterAi = await setup.service.submit({
      mode: 'search',
      sessionId: 'session-1',
      input: '查询资料',
      workspace: buildWorkspace(setup.workspaceRoot)
    })
    expect(searchAfterAi.success).toBe(false)
    expect(searchAfterAi.error).toContain('不能切换到搜索')

    await setup.storage.chat.saveChatSession({
      id: 'session-search',
      title: '搜索会话',
      created_at: Date.now(),
      workspace_id: 'workspace-1',
      pinned: false,
      pinned_at: null
    })
    await setup.storage.chatSearchTurn.appendTurn({
      sessionId: 'session-search',
      role: 'user',
      content: '查询资料'
    })
    const aiAfterSearch = await setup.service.submit({
      mode: 'ai',
      sessionId: 'session-search',
      input: '继续对话',
      mainModel: {
        configId: 'mock-config',
        modelName: 'mock-model'
      },
      workspace: buildWorkspace(setup.workspaceRoot)
    })
    expect(aiAfterSearch.success).toBe(false)
    expect(aiAfterSearch.error).toContain('不能切回 AI')
  })
})
