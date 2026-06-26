import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { StorageService } from '../../../../../src/main/services/storage/StorageService'
import { LANCE_TABLES } from '../../../../../src/main/services/storage/core/LanceDbCore'
import type { EmbeddingService } from '../../../../../src/main/services/vector/EmbeddingService'
import type { AiRunEvent, AiRunRecord, ChatSession } from '../../../../../src/shared/types'

type TestService = {
  storage: StorageService
  service: ChatRunService
  events: AiRunEvent[]
}

type ChatRunServicePrivate = ChatRunService & {
  queueRunEvent: (runId: string, event: AiRunEvent) => Promise<void>
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

const createTestService = async (options?: { autoStartRuns?: boolean }): Promise<TestService> => {
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
    autoStartRuns: options?.autoStartRuns ?? false
  })
  return { storage, service, events }
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
      expect(setup.events.map((event) => event.type)).toContain(
        'assistant_process_group_started'
      )
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
