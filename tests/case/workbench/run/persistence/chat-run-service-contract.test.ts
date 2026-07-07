import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { CONVERSATION_MEMORY_BATCH_MESSAGES } from '../../../../../src/main/services/ai/memory'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { StorageService } from '../../../../../src/main/services/storage/StorageService'
import { LANCE_TABLES } from '../../../../../src/main/services/storage/core/LanceDbCore'
import type { EmbeddingService } from '../../../../../src/main/services/vector/EmbeddingService'
import type {
  AiRunEvent,
  AiRunRecord,
  AiRuntimeSettings,
  ChatMessage,
  ChatSession
} from '../../../../../src/shared/types'

type TestService = {
  storage: StorageService
  service: ChatRunService
  events: AiRunEvent[]
  memorySummaryCalls: ChatMessage[][]
}

type ChatRunServicePrivate = ChatRunService & {
  queueRunEvent: (runId: string, event: AiRunEvent) => Promise<void>
  scheduleConversationMemoryUpdate: (input: {
    runId: string
    sessionId: string
    runtimeSettings: AiRuntimeSettings
    modelName: string
    sendEvent: (event: AiRunEvent) => void
  }) => Promise<void> | null
}

const tempRoots: string[] = []

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

type TestConversationMemorySummaryBuilder = NonNullable<
  ConstructorParameters<typeof ChatRunService>[0]['conversationMemorySummaryBuilder']
>

const createTestService = async (options?: {
  autoStartRuns?: boolean
  conversationMemorySummaryBuilder?: TestConversationMemorySummaryBuilder
}): Promise<TestService> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ncurator-chat-run-'))
  tempRoots.push(root)
  const storage = new StorageService({
    dbPath: path.join(root, 'lancedb')
  })
  await storage.initialize()
  const aiFileChangeService = new AiFileChangeService(storage.aiFileChange)
  const docxApplyService = new DocxApplyService(storage.docxApply, aiFileChangeService)
  const embeddingService = {
    embed: async () => ({ data: new Float32Array(768) })
  } as EmbeddingService
  const events: AiRunEvent[] = []
  const memorySummaryCalls: ChatMessage[][] = []
  const service = new ChatRunService({
    chatStore: storage.chat,
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
    broadcastEvent: (event) => {
      events.push(event)
    },
    autoStartRuns: options?.autoStartRuns ?? false,
    conversationMemorySummaryBuilder:
      options?.conversationMemorySummaryBuilder ||
      (async (input) => {
        memorySummaryCalls.push(input.messages)
        return [
          input.previousSummary,
          `batch:${input.messages.map((message) => message.id).join(',')}`
        ]
          .filter(Boolean)
          .join('\n')
      })
  })
  return { storage, service, events, memorySummaryCalls }
}

const seedSession = async (storage: StorageService): Promise<ChatSession> => {
  const session: ChatSession = {
    id: 'session-1',
    title: '新对话',
    created_at: Date.now(),
    workspace_id: 'workspace-1'
  }
  await storage.chat.saveChatSession(session)
  return session
}

const buildMessage = (input: {
  id: string
  sessionId?: string
  role?: ChatMessage['role']
  timestamp: number
  content?: string
}): ChatMessage => ({
  id: input.id,
  session_id: input.sessionId || 'session-1',
  role: input.role || (Number(input.id.replace(/\D/g, '') || 0) % 2 === 0 ? 'user' : 'assistant'),
  content: input.content || `message ${input.id}`,
  timestamp: input.timestamp
})

const saveMessages = async (
  storage: StorageService,
  messages: readonly ChatMessage[]
): Promise<void> => {
  for (const message of messages) {
    await storage.chat.saveChatMessage(message)
  }
}

const addRowsInChunks = async (
  table: { add: (rows: Array<Record<string, unknown>>) => Promise<void> },
  rows: Array<Record<string, unknown>>,
  chunkSize = 5000
): Promise<void> => {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await table.add(rows.slice(index, index + chunkSize))
  }
}

const submitAiRun = async ({ storage, service }: TestService) => {
  await seedSession(storage)
  const response = await service.submit({
    mode: 'ai',
    sessionId: 'session-1',
    input: '生成测试回答',
    modelName: 'mock-model',
    workspace: {
      workspaceId: 'workspace-1',
      workspaceName: 'workspace-1',
      rootPath: '/tmp'
    }
  })
  expect(response.success).toBe(true)
  expect(response.run).toBeTruthy()
  return response.run as AiRunRecord
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workbench chat run backend', () => {
  const performanceIt = process.env.NCURATOR_RUN_LANCEDB_CHAT_PERF === '1' ? it : it.skip

  it('chat-submit-ai-creates-placeholder-and-run', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)

    const messages = await setup.storage.chat.getChatMessages('session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1].content).toBe('')
    expect(storedRun?.status).toBe('running')
    expect(storedRun?.assistantMessageId).toBe(messages[1].id)
  })

  it('run-events-update-assistant-message-run-and-event-log', async () => {
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

    const messages = await setup.storage.chat.getChatMessages('session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)
    const events = await setup.storage.aiRun.listEvents(run.id)

    expect(messages[1].content).toBe('Hello world')
    expect(storedRun?.status).toBe('completed')
    expect(storedRun?.finalAnswer).toBe('Hello world')
    expect(events.map((event) => event.type)).toContain('answer_completed')
    expect(events.map((event) => event.type)).toContain('run_completed')
    expect(events.map((event) => event.type)).not.toContain('answer_token')
    expect(storedRun?.processEvents?.map((event) => event.type)).toContain('answer_completed')
  })

  it('token-events-are-not-persisted-or-reread-for-seq-allocation', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    const listEventsSpy = vi.spyOn(setup.storage.aiRun, 'listEvents')

    for (let index = 0; index < 25; index += 1) {
      await service.queueRunEvent(run.id, {
        type: 'answer_token',
        runId: run.id,
        token: String(index)
      })
    }
    await service.queueRunEvent(run.id, {
      type: 'answer_completed',
      runId: run.id,
      text: 'done'
    })
    await service.queueRunEvent(run.id, {
      type: 'run_completed',
      runId: run.id
    })

    expect(listEventsSpy).toHaveBeenCalledTimes(1)
    listEventsSpy.mockRestore()

    const events = await setup.storage.aiRun.listEvents(run.id)
    expect(events.map((event) => event.type)).toEqual(['answer_completed', 'run_completed'])
    expect(events.map((event) => event.seq)).toEqual([1, 2])
  })

  it('chat-store-conversation-memory-batch-boundaries', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    const messages = Array.from({ length: 15 }, (_, index) =>
      buildMessage({
        id: `memory-message-${index + 1}`,
        timestamp: baseTime + index
      })
    )
    await saveMessages(setup.storage, messages)

    const firstBatch = await setup.storage.chat.getNextConversationMemoryBatch({
      sessionId: 'session-1',
      batchSize: CONVERSATION_MEMORY_BATCH_MESSAGES
    })
    expect(firstBatch.batch.map((message) => message.id)).toEqual(
      messages.slice(0, 12).map((message) => message.id)
    )
    expect(firstBatch.targetCoveredMessageId).toBe('memory-message-12')
    expect(firstBatch.targetCoveredMessageCount).toBe(12)

    await setup.storage.chat.saveConversationMemory('session-1', {
      summary: 'covered first batch',
      coveredMessageId: firstBatch.targetCoveredMessageId,
      coveredTimestamp: firstBatch.targetCoveredTimestamp,
      coveredMessageCount: firstBatch.targetCoveredMessageCount,
      updatedAt: Date.now()
    })
    const recentTurns = await setup.storage.chat.getMessagesAfterConversationMemory('session-1')
    expect(recentTurns.map((message) => message.id)).toEqual([
      'memory-message-13',
      'memory-message-14',
      'memory-message-15'
    ])
    const partialNextBatch = await setup.storage.chat.getNextConversationMemoryBatch({
      sessionId: 'session-1',
      batchSize: CONVERSATION_MEMORY_BATCH_MESSAGES
    })
    expect(partialNextBatch.batch.map((message) => message.id)).toEqual([
      'memory-message-13',
      'memory-message-14',
      'memory-message-15'
    ])
    expect(partialNextBatch.targetCoveredMessageCount).toBe(15)

    await setup.storage.chat.saveConversationMemory('session-1', {
      summary: 'missing covered id falls back to timestamp',
      coveredMessageId: 'deleted-memory-message',
      coveredTimestamp: messages[4].timestamp,
      coveredMessageCount: 5,
      updatedAt: Date.now()
    })
    const fallbackBatch = await setup.storage.chat.getNextConversationMemoryBatch({
      sessionId: 'session-1',
      batchSize: CONVERSATION_MEMORY_BATCH_MESSAGES
    })
    expect(fallbackBatch.batch[0].id).toBe('memory-message-6')
    expect(fallbackBatch.targetCoveredMessageId).toBe('memory-message-15')
    expect(fallbackBatch.targetCoveredMessageCount).toBe(15)
  })

  it('conversation-memory-background-job-batches-and-guards-writes', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const service = setup.service as ChatRunServicePrivate
    const runtimeSettings = await setup.storage.aiRuntimeSettings.get()
    const baseTime = Date.now()

    await saveMessages(
      setup.storage,
      Array.from({ length: 11 }, (_, index) =>
        buildMessage({ id: `short-memory-${index + 1}`, timestamp: baseTime + index })
      )
    )
    const shortJob = service.scheduleConversationMemoryUpdate({
      runId: 'run-short',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })
    await shortJob
    expect(await setup.storage.chat.getConversationMemory('session-1')).toBeNull()
    expect(setup.memorySummaryCalls).toEqual([])

    await setup.storage.chat.saveChatMessage(
      buildMessage({ id: 'short-memory-12', timestamp: baseTime + 12 })
    )
    const completeJob = service.scheduleConversationMemoryUpdate({
      runId: 'run-complete',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })
    await completeJob
    await waitForCondition(async () =>
      Boolean((await setup.storage.chat.getConversationMemory('session-1'))?.coveredMessageId)
    )
    const saved = await setup.storage.chat.getConversationMemory('session-1')
    expect(saved?.summary).toContain('batch:short-memory-1')
    expect(saved?.coveredMessageId).toBe('short-memory-12')
    expect(saved?.coveredMessageCount).toBe(12)
    expect(setup.memorySummaryCalls).toHaveLength(1)

    const failing = await createTestService({
      conversationMemorySummaryBuilder: async () => {
        throw new Error('summary failed')
      }
    })
    await seedSession(failing.storage)
    await saveMessages(
      failing.storage,
      Array.from({ length: 12 }, (_, index) =>
        buildMessage({ id: `failing-memory-${index + 1}`, timestamp: baseTime + 100 + index })
      )
    )
    const failingService = failing.service as ChatRunServicePrivate
    const failingJob = failingService.scheduleConversationMemoryUpdate({
      runId: 'run-failing',
      sessionId: 'session-1',
      runtimeSettings: await failing.storage.aiRuntimeSettings.get(),
      modelName: 'mock-model',
      sendEvent: (event) => failing.events.push(event)
    })
    await failingJob
    expect(await failing.storage.chat.getConversationMemory('session-1')).toBeNull()

    const stale = await createTestService({
      conversationMemorySummaryBuilder: async (input) => {
        await stale.storage.chat.saveConversationMemory('session-1', {
          summary: 'external update wins',
          coveredMessageId: 'external-covered',
          coveredTimestamp: Date.now() + 100_000,
          coveredMessageCount: 99,
          updatedAt: Date.now()
        })
        return `stale:${input.messages.length}`
      }
    })
    await seedSession(stale.storage)
    await saveMessages(
      stale.storage,
      Array.from({ length: 12 }, (_, index) =>
        buildMessage({ id: `stale-memory-${index + 1}`, timestamp: baseTime + 200 + index })
      )
    )
    const staleService = stale.service as ChatRunServicePrivate
    const staleJob = staleService.scheduleConversationMemoryUpdate({
      runId: 'run-stale',
      sessionId: 'session-1',
      runtimeSettings: await stale.storage.aiRuntimeSettings.get(),
      modelName: 'mock-model',
      sendEvent: (event) => stale.events.push(event)
    })
    await staleJob
    await waitForCondition(async () => {
      const memory = await stale.storage.chat.getConversationMemory('session-1')
      return memory?.summary === 'external update wins'
    })
    expect((await stale.storage.chat.getConversationMemory('session-1'))?.coveredMessageId).toBe(
      'external-covered'
    )
  })

  it('conversation-memory-background-job-dedupes-same-session-work', async () => {
    let releaseSummary: (() => void) | null = null
    const calls: ChatMessage[][] = []
    const setup = await createTestService({
      conversationMemorySummaryBuilder: async (input) => {
        calls.push(input.messages)
        await new Promise<void>((resolve) => {
          releaseSummary = resolve
        })
        return `deduped:${input.messages.map((message) => message.id).join(',')}`
      }
    })
    await seedSession(setup.storage)
    const runtimeSettings = await setup.storage.aiRuntimeSettings.get()
    const service = setup.service as ChatRunServicePrivate
    const baseTime = Date.now()
    await saveMessages(
      setup.storage,
      Array.from({ length: 12 }, (_, index) =>
        buildMessage({ id: `dedupe-memory-${index + 1}`, timestamp: baseTime + index })
      )
    )

    const firstJob = service.scheduleConversationMemoryUpdate({
      runId: 'run-dedupe-1',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })
    const secondJob = service.scheduleConversationMemoryUpdate({
      runId: 'run-dedupe-2',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })

    await waitForCondition(() => calls.length === 1)
    expect(secondJob).toBeNull()
    releaseSummary?.()
    await firstJob
    await waitForCondition(async () =>
      Boolean((await setup.storage.chat.getConversationMemory('session-1'))?.summary)
    )
    expect(calls).toHaveLength(1)
    expect((await setup.storage.chat.getConversationMemory('session-1'))?.coveredMessageCount).toBe(
      12
    )
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
      const storedEvents = await setup.storage.aiRun.listEvents(run.id)

      expect(setup.events.map((event) => event.type)).toContain('run_started')
      expect(setup.events.map((event) => event.type)).toContain('assistant_process_group_started')
      expect(storedRun?.status).toBe('failed')
      expect(storedEvents.map((event) => event.type)).toContain('run_failed')
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS
      } else {
        process.env.NCURATOR_AI_EMBEDDING_PREFLIGHT_TIMEOUT_MS = previousTimeout
      }
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

  it('session-open-returns-messages-and-active-runs-without-full-event-replay', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    await service.queueRunEvent(run.id, {
      type: 'assistant_process_group_started',
      runId: run.id,
      groupId: `${run.id}:thinking`,
      kind: 'thinking',
      display: { kind: 'thinking' },
      createdAt: Date.now()
    })
    const listEventsSpy = vi.spyOn(setup.storage.aiRun, 'listEvents')

    const opened = await setup.service.openSession({ sessionId: 'session-1', limit: 50 })

    expect(opened.messages).toHaveLength(2)
    expect(opened.activeRuns).toHaveLength(1)
    expect(opened.activeRuns[0].events.map((event) => event.type)).toContain(
      'assistant_process_group_started'
    )
    expect(listEventsSpy).not.toHaveBeenCalled()
    listEventsSpy.mockRestore()
  })

  it('completed-run-process-events-are-restored-through-session-snapshot', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate

    await service.queueRunEvent(run.id, {
      type: 'assistant_process_group_started',
      runId: run.id,
      groupId: `${run.id}:thinking`,
      kind: 'thinking',
      display: { kind: 'thinking' },
      createdAt: Date.now()
    })
    await service.queueRunEvent(run.id, {
      type: 'answer_token',
      runId: run.id,
      token: 'partial'
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
    expect(snapshot.runs?.[0].events.map((event) => event.type)).toContain(
      'assistant_process_group_started'
    )
    expect(snapshot.runs?.[0].events.map((event) => event.type)).toContain('answer_completed')
    expect(snapshot.runs?.[0].events.map((event) => event.type)).not.toContain('answer_token')
  })

  it('startup-recovery-marks-interrupted-runs-failed', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const now = Date.now()
    await setup.storage.chat.saveChatMessage({
      id: 'assistant-1',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      timestamp: now
    })
    await setup.storage.aiRun.saveRun({
      id: 'run-1',
      sessionId: 'session-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      input: '测试中断',
      partialAnswer: '',
      createdAt: now,
      updatedAt: now
    })

    await setup.service.failInterruptedRuns()

    const storedRun = await setup.storage.aiRun.getRun('run-1')
    const messages = await setup.storage.chat.getChatMessages('session-1')

    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error).toContain('运行已中断')
    expect(messages[0].content).toContain('运行已中断')
    expect(messages[0].error).toBe(true)
  })

  it('retract-latest-turn-guards-running-and-non-latest-user-message', async () => {
    const runningSetup = await createTestService()
    const runningRun = await submitAiRun(runningSetup)
    const runningMessages = await runningSetup.storage.chat.getChatMessages('session-1')
    const runningResponse = await runningSetup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: runningRun.userMessageId
    })
    expect(runningResponse.success).toBe(false)
    expect(runningResponse.error).toContain('仍在运行')
    expect(await runningSetup.storage.chat.getChatMessages('session-1')).toHaveLength(
      runningMessages.length
    )

    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    await saveMessages(setup.storage, [
      buildMessage({ id: 'old-user', role: 'user', timestamp: baseTime }),
      buildMessage({ id: 'old-assistant', role: 'assistant', timestamp: baseTime + 1 }),
      buildMessage({ id: 'latest-user', role: 'user', timestamp: baseTime + 2 }),
      buildMessage({ id: 'latest-assistant', role: 'assistant', timestamp: baseTime + 3 })
    ])

    const response = await setup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: 'old-user'
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('最新')
    expect(await setup.storage.chat.getChatMessages('session-1')).toHaveLength(4)
  })

  it('retract-latest-turn-removes-user-assistant-run-and-clears-covered-memory', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    await saveMessages(setup.storage, [
      buildMessage({ id: 'kept-user', role: 'user', timestamp: baseTime }),
      buildMessage({ id: 'kept-assistant', role: 'assistant', timestamp: baseTime + 1 }),
      buildMessage({ id: 'retract-user', role: 'user', timestamp: baseTime + 2 }),
      buildMessage({ id: 'retract-assistant', role: 'assistant', timestamp: baseTime + 3 })
    ])
    await setup.storage.aiRun.saveRun({
      id: 'retract-run',
      sessionId: 'session-1',
      userMessageId: 'retract-user',
      assistantMessageId: 'retract-assistant',
      status: 'completed',
      input: 'retract me',
      partialAnswer: 'done',
      finalAnswer: 'done',
      createdAt: baseTime + 2,
      updatedAt: baseTime + 3,
      finishedAt: baseTime + 3
    })
    await setup.storage.chat.saveConversationMemory('session-1', {
      summary: 'covers latest turn',
      coveredMessageId: 'retract-assistant',
      coveredTimestamp: baseTime + 3,
      coveredMessageCount: 4,
      updatedAt: Date.now()
    })

    const response = await setup.service.retractLatestTurn({
      sessionId: 'session-1',
      userMessageId: 'retract-user'
    })

    expect(response.success).toBe(true)
    expect(response.userMessage?.id).toBe('retract-user')
    expect(response.assistantMessageId).toBe('retract-assistant')
    expect(response.runId).toBe('retract-run')
    expect(response.memoryCleared).toBe(true)
    expect(response.messages.map((message) => message.id)).toEqual(['kept-user', 'kept-assistant'])
    expect(await setup.storage.aiRun.getRun('retract-run')).toBeNull()
    expect(await setup.storage.chat.getConversationMemory('session-1')).toBeNull()
  })

  it('delete-session-cleans-run-and-event-records', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate
    await service.queueRunEvent(run.id, {
      type: 'answer_token',
      runId: run.id,
      token: 'partial'
    })

    await setup.service.deleteSession('session-1')

    const sessions = await setup.storage.chat.getChatSessions()
    const messages = await setup.storage.chat.getChatMessages('session-1')
    const storedRun = await setup.storage.aiRun.getRun(run.id)
    const events = await setup.storage.aiRun.listEvents(run.id)

    expect(sessions).toEqual([])
    expect(messages).toEqual([])
    expect(storedRun).toBeNull()
    expect(events).toEqual([])
  })

  performanceIt('lancedb-chat-session-open-performance-shape', async () => {
    const setup = await createTestService()
    const startedAt = Date.now()
    const baseTime = Date.now() - 1_000_000
    const sessionRows: Array<Record<string, unknown>> = []
    const messageRows: Array<Record<string, unknown>> = []
    const runRows: Array<Record<string, unknown>> = []
    const eventRows: Array<Record<string, unknown>> = []

    for (let sessionIndex = 0; sessionIndex < 100; sessionIndex += 1) {
      const sessionId = `perf-session-${sessionIndex}`
      sessionRows.push({
        id: sessionId,
        title: `性能会话 ${sessionIndex}`,
        created_at: baseTime + sessionIndex,
        workspace_id: 'workspace-1'
      })
      for (let messageIndex = 0; messageIndex < 20; messageIndex += 1) {
        messageRows.push({
          id: `${sessionId}-message-${messageIndex}`,
          session_id: sessionId,
          role: messageIndex % 2 === 0 ? 'user' : 'assistant',
          content: `message ${messageIndex}`,
          timestamp: baseTime + sessionIndex * 10_000 + messageIndex
        })
      }
      for (let runIndex = 0; runIndex < 5; runIndex += 1) {
        const runId = `${sessionId}-run-${runIndex}`
        const events: AiRunEvent[] = Array.from({ length: 200 }, (_, eventIndex) => ({
          type: 'assistant_process_thought',
          runId,
          thoughtId: `${runId}-thought-${eventIndex}`,
          text: `thought ${eventIndex}`,
          createdAt: baseTime + eventIndex
        }))
        runRows.push({
          id: runId,
          session_id: sessionId,
          user_message_id: `${sessionId}-message-0`,
          assistant_message_id: `${sessionId}-message-1`,
          status: 'completed',
          input: 'perf',
          partial_answer: 'done',
          final_answer: 'done',
          process_events_json: JSON.stringify(events),
          event_count: events.length,
          visible_event_count: events.length,
          last_event_at: baseTime + events.length,
          created_at: baseTime + runIndex,
          updated_at: baseTime + runIndex,
          finished_at: baseTime + runIndex
        })
        eventRows.push(
          ...events.map((event, eventIndex) => ({
            id: `${runId}-event-${eventIndex}`,
            run_id: runId,
            session_id: sessionId,
            seq: eventIndex + 1,
            type: event.type,
            event_json: JSON.stringify(event),
            created_at: baseTime + eventIndex
          }))
        )
      }
    }

    const sessionTable = await setup.storage.core.openTable(LANCE_TABLES.CHAT_SESSION)
    const messageTable = await setup.storage.core.openTable(LANCE_TABLES.CHAT_MESSAGE)
    const runTable = await setup.storage.core.openTable(LANCE_TABLES.AI_RUN)
    const eventTable = await setup.storage.core.openTable(LANCE_TABLES.AI_RUN_EVENT)
    await sessionTable.add(sessionRows)
    await messageTable.add(messageRows)
    await runTable.add(runRows)
    await addRowsInChunks(eventTable, eventRows)

    const extremeSessionId = 'perf-session-0'
    const extremeRunId = `${extremeSessionId}-extreme-token-run`
    await setup.storage.aiRun.saveRun({
      id: extremeRunId,
      sessionId: extremeSessionId,
      userMessageId: `${extremeSessionId}-message-0`,
      assistantMessageId: `${extremeSessionId}-message-1`,
      status: 'completed',
      input: 'extreme',
      partialAnswer: 'done',
      finalAnswer: 'done',
      processEvents: [],
      eventCount: 3000,
      visibleEventCount: 0,
      createdAt: baseTime,
      updatedAt: baseTime,
      finishedAt: baseTime
    })
    await setup.storage.aiRun.appendEvents({
      runId: extremeRunId,
      sessionId: extremeSessionId,
      events: Array.from({ length: 3000 }, (_, index) => ({
        type: 'answer_token',
        runId: extremeRunId,
        token: String(index)
      }))
    })

    const snapshotStartedAt = Date.now()
    const snapshot = await setup.service.getSessionSnapshot(extremeSessionId)
    const snapshotDurationMs = Date.now() - snapshotStartedAt

    const openStartedAt = Date.now()
    const opened = await setup.service.openSession({ sessionId: extremeSessionId, limit: 50 })
    const openDurationMs = Date.now() - openStartedAt

    console.info('[LANCEDB-CHAT-PERF]', {
      seedDurationMs: snapshotStartedAt - startedAt,
      snapshotDurationMs,
      openDurationMs,
      messages: opened.messages.length,
      snapshotRuns: snapshot.runs?.length || 0,
      activeRuns: opened.activeRuns.length,
      eventRows: eventRows.length
    })
    expect(opened.messages).toHaveLength(20)
    expect(openDurationMs).toBeLessThan(300)
  })
})
