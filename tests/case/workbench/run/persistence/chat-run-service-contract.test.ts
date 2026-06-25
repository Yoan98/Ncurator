import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { StorageService } from '../../../../../src/main/services/storage/StorageService'
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
  })

  it('run-event-append-keeps-sequential-seq-without-rereading-log-per-token', async () => {
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
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1)
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
})
