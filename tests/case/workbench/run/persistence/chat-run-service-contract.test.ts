import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRunService } from '../../../../../src/main/services/ai/ChatRunService'
import { AiRunResourceManager } from '../../../../../src/main/services/ai/run/AiRunResourceManager'
import {
  CONVERSATION_MEMORY_RECENT_TURNS,
  CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
} from '../../../../../src/main/services/ai/memory'
import { AiFileChangeService } from '../../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { StorageService } from '../../../../../src/main/services/storage/StorageService'
import type { EmbeddingService } from '../../../../../src/main/services/vector/EmbeddingService'
import type {
  AiRunEvent,
  AiRunRecord,
  AiRuntimeSettings,
  ChatMessage,
  ChatSession
} from '../../../../../src/shared/types'

type TestService = {
  workspaceRoot: string
  storage: StorageService
  service: ChatRunService
  events: AiRunEvent[]
  memorySummaryCalls: ChatMessage[][]
}

type ChatRunServicePrivate = ChatRunService & {
  queueRunEvent: (runId: string, event: AiRunEvent) => Promise<void>
  requestUserTakeover: (
    runId: string,
    request: { taskId: string; requestId: string; message: string }
  ) => Promise<{ confirmed: true } | { confirmed: false; error: string }>
  scheduleConversationMemoryUpdate: (input: {
    runId: string
    sessionId: string
    runtimeSettings: AiRuntimeSettings
    modelName: string
    sendEvent: (event: AiRunEvent) => void
  }) => Promise<void> | null
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

type TestConversationMemorySummaryBuilder = NonNullable<
  ConstructorParameters<typeof ChatRunService>[0]['conversationMemorySummaryBuilder']
>

const createTestService = async (options?: {
  autoStartRuns?: boolean
  conversationMemorySummaryBuilder?: TestConversationMemorySummaryBuilder
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
    runResourceManager: new AiRunResourceManager(),
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
      }),
    onRunTerminal: options?.onRunTerminal
  })
  return { workspaceRoot, storage, service, events, memorySummaryCalls }
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

const buildConversationTurns = (input: {
  prefix: string
  count: number
  startTime: number
}): ChatMessage[] =>
  Array.from({ length: input.count }, (_, index) => {
    const turn = index + 1
    return [
      buildMessage({
        id: `${input.prefix}-user-${turn}`,
        role: 'user',
        timestamp: input.startTime + index * 2
      }),
      buildMessage({
        id: `${input.prefix}-assistant-${turn}`,
        role: 'assistant',
        timestamp: input.startTime + index * 2 + 1
      })
    ]
  }).flat()

const submitAiRun = async ({ workspaceRoot, storage, service }: TestService) => {
  await seedSession(storage)
  const response = await service.submit({
    mode: 'ai',
    preference: 'local_sources_strict',
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
    expect(run.preference).toBe('local_sources_strict')
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
    expect(storedRun?.processEvents).toBeUndefined()
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

    const messages = await setup.storage.chat.getChatMessages('session-1')
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

  it('user-takeover-pauses-persists-and-resumes-the-run', async () => {
    const setup = await createTestService()
    const run = await submitAiRun(setup)
    const service = setup.service as ChatRunServicePrivate

    const takeoverResult = service.requestUserTakeover(run.id, {
      taskId: 'task-1',
      requestId: 'takeover-1',
      message: '请在右侧浏览器完成登录'
    })

    await waitForCondition(() =>
      setup.events.some((event) => event.type === 'user_takeover_required')
    )
    const waitingRun = await setup.storage.aiRun.getRun(run.id)
    expect(waitingRun?.status).toBe('waiting_user_takeover')
    expect(waitingRun?.pendingUserTakeover?.requestId).toBe('takeover-1')

    const response = await setup.service.confirmUserTakeover({
      runId: run.id,
      requestId: 'takeover-1'
    })
    expect(response).toEqual({ success: true })
    await expect(takeoverResult).resolves.toEqual({ confirmed: true })

    const resumedRun = await setup.storage.aiRun.getRun(run.id)
    expect(resumedRun?.status).toBe('running')
    expect(resumedRun?.pendingUserTakeover).toBeUndefined()
    expect(setup.events.map((event) => event.type)).toContain('user_takeover_confirmed')
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

    expect(listEventsSpy).not.toHaveBeenCalled()
    listEventsSpy.mockRestore()

    const events = await setup.storage.aiRun.listEvents(run.id)
    expect(events.map((event) => event.type)).toEqual(['answer_completed', 'run_completed'])
    expect(events.map((event) => event.seq)).toEqual([1, 2])
  })

  it('chat-store-conversation-memory-compaction-keeps-the-latest-five-turns', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const baseTime = Date.now()
    const messages = buildConversationTurns({ prefix: 'memory', count: 10, startTime: baseTime })
    await saveMessages(setup.storage, messages)

    const compaction = await setup.storage.chat.getConversationMemoryCompaction({
      sessionId: 'session-1',
      recentTurns: CONVERSATION_MEMORY_RECENT_TURNS,
      triggerTurns: CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
    })
    expect(compaction?.messagesToSummarize.map((message) => message.id)).toEqual(
      messages.slice(0, 10).map((message) => message.id)
    )
    expect(compaction?.targetCoveredMessageId).toBe('memory-assistant-5')
    expect(compaction?.targetCoveredMessageCount).toBe(10)

    await setup.storage.chat.saveConversationMemory('session-1', {
      summary: 'covered first five turns',
      coveredMessageId: compaction?.targetCoveredMessageId || null,
      coveredTimestamp: compaction?.targetCoveredTimestamp || null,
      coveredMessageCount: compaction?.targetCoveredMessageCount || 0,
      revision: 1,
      updatedAt: Date.now()
    })
    const recentTurns = await setup.storage.chat.getMessagesAfterConversationMemory('session-1')
    expect(recentTurns.map((message) => message.id)).toEqual(
      messages.slice(10).map((message) => message.id)
    )
    const belowTrigger = await setup.storage.chat.getConversationMemoryCompaction({
      sessionId: 'session-1',
      recentTurns: CONVERSATION_MEMORY_RECENT_TURNS,
      triggerTurns: CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
    })
    expect(belowTrigger).toBeNull()

    await saveMessages(
      setup.storage,
      buildConversationTurns({ prefix: 'later', count: 4, startTime: baseTime + 100 })
    )
    await setup.storage.chat.saveChatMessage(
      buildMessage({ id: 'later-user-5', role: 'user', timestamp: baseTime + 108 })
    )
    expect(
      await setup.storage.chat.getConversationMemoryCompaction({
        sessionId: 'session-1',
        recentTurns: CONVERSATION_MEMORY_RECENT_TURNS,
        triggerTurns: CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
      })
    ).toBeNull()

    await setup.storage.chat.saveChatMessage(
      buildMessage({ id: 'later-assistant-5', role: 'assistant', timestamp: baseTime + 109 })
    )
    const nextCompaction = await setup.storage.chat.getConversationMemoryCompaction({
      sessionId: 'session-1',
      recentTurns: CONVERSATION_MEMORY_RECENT_TURNS,
      triggerTurns: CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
    })
    expect(nextCompaction?.targetCoveredMessageId).toBe('memory-assistant-10')
    expect(nextCompaction?.messagesToSummarize).toHaveLength(10)
  })

  it('conversation-memory-background-job-triggers-at-ten-turns-and-compacts-to-five', async () => {
    const setup = await createTestService()
    await seedSession(setup.storage)
    const service = setup.service as ChatRunServicePrivate
    const runtimeSettings = await setup.storage.aiRuntimeSettings.get()
    const baseTime = Date.now()

    await saveMessages(
      setup.storage,
      buildConversationTurns({ prefix: 'threshold', count: 9, startTime: baseTime })
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

    await saveMessages(setup.storage, [
      buildMessage({ id: 'threshold-user-10', role: 'user', timestamp: baseTime + 18 }),
      buildMessage({
        id: 'threshold-assistant-10',
        role: 'assistant',
        timestamp: baseTime + 19
      })
    ])
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
    expect(saved?.summary).toContain('batch:threshold-user-1')
    expect(saved?.coveredMessageId).toBe('threshold-assistant-5')
    expect(saved?.coveredMessageCount).toBe(10)
    expect(saved?.revision).toBe(1)
    expect(setup.memorySummaryCalls).toHaveLength(1)
    const recent = await setup.storage.chat.getMessagesAfterConversationMemory('session-1')
    expect(recent).toHaveLength(10)
    expect(recent[0].id).toBe('threshold-user-6')

    await saveMessages(
      setup.storage,
      buildConversationTurns({ prefix: 'next-cycle', count: 4, startTime: baseTime + 1_000 })
    )
    await service.scheduleConversationMemoryUpdate({
      runId: 'run-next-cycle-below-threshold',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })
    expect(setup.memorySummaryCalls).toHaveLength(1)

    await saveMessages(setup.storage, [
      buildMessage({ id: 'next-cycle-user-5', role: 'user', timestamp: baseTime + 1_008 }),
      buildMessage({
        id: 'next-cycle-assistant-5',
        role: 'assistant',
        timestamp: baseTime + 1_009
      })
    ])
    await service.scheduleConversationMemoryUpdate({
      runId: 'run-next-cycle-trigger',
      sessionId: 'session-1',
      runtimeSettings,
      modelName: 'mock-model',
      sendEvent: (event) => setup.events.push(event)
    })
    const secondCycleMemory = await setup.storage.chat.getConversationMemory('session-1')
    expect(setup.memorySummaryCalls).toHaveLength(2)
    expect(secondCycleMemory?.coveredMessageId).toBe('threshold-assistant-10')
    expect(secondCycleMemory?.revision).toBe(2)
    expect(await setup.storage.chat.getMessagesAfterConversationMemory('session-1')).toHaveLength(
      10
    )

    const failing = await createTestService({
      conversationMemorySummaryBuilder: async () => {
        throw new Error('summary failed')
      }
    })
    await seedSession(failing.storage)
    await saveMessages(
      failing.storage,
      buildConversationTurns({ prefix: 'failing', count: 10, startTime: baseTime + 100 })
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
    expect(await failing.storage.chat.getMessagesAfterConversationMemory('session-1')).toHaveLength(
      20
    )

    let externalUpdateWritten = false
    const stale = await createTestService({
      conversationMemorySummaryBuilder: async (input) => {
        if (!externalUpdateWritten) {
          externalUpdateWritten = true
          await stale.storage.chat.saveConversationMemory('session-1', {
            summary: 'external update wins',
            coveredMessageId: 'stale-assistant-5',
            coveredTimestamp: baseTime + 209,
            coveredMessageCount: 10,
            revision: 1,
            updatedAt: Date.now()
          })
        }
        return `stale:${input.messages.length}`
      }
    })
    await seedSession(stale.storage)
    await saveMessages(
      stale.storage,
      buildConversationTurns({ prefix: 'stale', count: 10, startTime: baseTime + 200 })
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
    const staleMemory = await stale.storage.chat.getConversationMemory('session-1')
    expect(staleMemory?.summary).toBe('external update wins')
    expect(staleMemory?.coveredMessageId).toBe('stale-assistant-5')
    expect(stale.memorySummaryCalls).toHaveLength(0)
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
      buildConversationTurns({ prefix: 'dedupe', count: 10, startTime: baseTime })
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
    const pendingContext = await setup.storage.chat.getConversationMemoryContext('session-1')
    expect(pendingContext.memory).toBeNull()
    expect(pendingContext.recentMessages).toHaveLength(20)
    await saveMessages(
      setup.storage,
      buildConversationTurns({ prefix: 'during-summary', count: 2, startTime: baseTime + 100 })
    )
    releaseSummary?.()
    await firstJob
    await waitForCondition(async () =>
      Boolean((await setup.storage.chat.getConversationMemory('session-1'))?.summary)
    )
    expect(calls).toHaveLength(1)
    expect((await setup.storage.chat.getConversationMemory('session-1'))?.coveredMessageCount).toBe(
      10
    )
    const committedContext = await setup.storage.chat.getConversationMemoryContext('session-1')
    expect(committedContext.recentMessages).toHaveLength(14)
    expect(committedContext.recentMessages[0].id).toBe('dedupe-user-6')
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
    const listRunsByMessageIdsSpy = vi.spyOn(setup.storage.aiRun, 'listRunsByMessageIds')

    const opened = await setup.service.openSession({ sessionId: 'session-1', limit: 50 })

    expect(opened.messages).toHaveLength(2)
    expect(opened.activeRuns).toHaveLength(1)
    expect(opened.activeRuns[0].events.map((event) => event.type)).toContain(
      'assistant_process_group_started'
    )
    expect(listEventsSpy).toHaveBeenCalledTimes(1)
    expect(listRunsByMessageIdsSpy).not.toHaveBeenCalled()
    listEventsSpy.mockRestore()
    listRunsByMessageIdsSpy.mockRestore()
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

  it('completed-run-process-events-are-restored-through-run-summaries', async () => {
    // Switching back to a conversation goes through getSessionRunSummaries, whose
    // snapshots must re-hydrate a completed run's events from the ai_run_event table
    // (run.processEvents is empty when loaded from storage).
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

    const summaries = await setup.service.getSessionRunSummaries('session-1')

    expect(summaries.runs).toHaveLength(1)
    expect(summaries.runs[0].run.status).toBe('completed')
    expect(summaries.runs[0].events.map((event) => event.type)).toContain(
      'assistant_process_group_started'
    )
    expect(summaries.runs[0].events.map((event) => event.type)).toContain('answer_completed')
    expect(summaries.runs[0].events.map((event) => event.type)).not.toContain('answer_token')
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
    await setup.storage.chat.saveSessionResumeSnapshot('session-1', {
      reason: 'process_interrupted',
      runId: 'run-1',
      userInput: '测试中断',
      selectedReferences: [],
      humanState: {
        memory: {
          taskRun: {
            rounds: []
          }
        }
      },
      errorMessage: '运行中断恢复快照',
      updatedAt: now
    })

    await setup.service.failInterruptedRuns()

    const storedRun = await setup.storage.aiRun.getRun('run-1')
    const messages = await setup.storage.chat.getChatMessages('session-1')
    const events = await setup.storage.aiRun.listEvents('run-1')
    const snapshot = await setup.storage.chat.getSessionResumeSnapshot('session-1')

    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error).toContain('运行已中断')
    expect(messages[0].content).toContain('运行已中断')
    expect(messages[0].error).toBe(true)
    expect(events.at(-1)?.event).toMatchObject({
      type: 'run_failed',
      code: 'process_interrupted',
      resumeSnapshotSaved: true
    })
    expect(snapshot?.reason).toBe('process_interrupted')
  })

  it('retract-latest-turn-guards-running-and-non-latest-user-message', async () => {
    const runningSetup = await createTestService()
    const runningRun = await submitAiRun(runningSetup)
    await runningSetup.storage.chat.saveSessionResumeSnapshot('session-1', {
      reason: 'user_cancelled',
      runId: runningRun.id,
      userInput: runningRun.input,
      selectedReferences: [],
      humanState: {},
      errorMessage: 'keep snapshot when retract is rejected',
      updatedAt: Date.now()
    })
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
    expect(await runningSetup.storage.chat.getSessionResumeSnapshot('session-1')).not.toBeNull()

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
    await setup.storage.chat.saveSessionResumeSnapshot('session-1', {
      reason: 'user_cancelled',
      runId: 'retract-run',
      userInput: 'retract me',
      selectedReferences: [],
      humanState: {
        memory: {
          taskRun: {
            rounds: [{ summary: 'stale interrupted task state' }]
          }
        }
      },
      errorMessage: 'cancelled',
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
    expect(await setup.storage.chat.getSessionResumeSnapshot('session-1')).toBeNull()
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
