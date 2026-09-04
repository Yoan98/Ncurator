import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AiRunEvent,
  AiRunRecord,
  ChatSession,
  ChatSessionUiStateV1
} from '../../../../src/shared/types'
import { LanceDbCore } from '../../../../src/main/services/storage/core/LanceDbCore'
import { ChatStore } from '../../../../src/main/services/storage/domains/ChatStore'
import { ChatSearchTurnStore } from '../../../../src/main/services/storage/domains/ChatSearchTurnStore'
import { AiRunStore } from '../../../../src/main/services/storage/domains/AiRunStore'
import { DocumentsStore } from '../../../../src/main/services/storage/domains/DocumentsStore'
import { BrowserTabStateStore } from '../../../../src/main/services/storage/domains/BrowserTabStateStore'
import { WorkbenchUiStore } from '../../../../src/main/services/storage/domains/WorkbenchUiStore'
import { StorageService } from '../../../../src/main/services/storage/StorageService'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { AiRuntimeSettingsStore } from '../../../../src/main/services/storage/domains/AiRuntimeSettingsStore'
import { repairFalseDocxChangeFailuresMigration } from '../../../../src/main/services/storage/sqlite/migrations/005_repair_false_docx_change_failures'
import { repairAiRuntimeSystemNotificationsColumnMigration } from '../../../../src/main/services/storage/sqlite/migrations/009_repair_ai_runtime_system_notifications_column'

type VectorRow = Record<string, unknown>

class MemoryVectorQuery {
  private whereClause = ''
  private limitCount = Number.POSITIVE_INFINITY
  private offsetCount = 0

  public constructor(private readonly rows: VectorRow[]) {}

  public where(clause: string): this {
    this.whereClause = clause
    return this
  }

  public limit(count: number): this {
    this.limitCount = count
    return this
  }

  public offset(count: number): this {
    this.offsetCount = count
    return this
  }

  public fullTextSearch(): this {
    return this
  }

  public nearestTo(): this {
    return this
  }

  public distanceType(): this {
    return this
  }

  public rerank(): this {
    return this
  }

  public async toArray(): Promise<VectorRow[]> {
    return applyLanceWhere(this.rows, this.whereClause).slice(
      this.offsetCount,
      this.offsetCount + this.limitCount
    )
  }
}

class MemoryVectorTable {
  public readonly addBatches: VectorRow[][] = []

  public constructor(private rows: VectorRow[] = []) {}

  public async add(rows: VectorRow[]): Promise<void> {
    this.addBatches.push(rows)
    this.rows.push(...rows)
  }

  public async delete(where: string): Promise<void> {
    const toDelete = new Set(applyLanceWhere(this.rows, where).map((row) => row.id))
    this.rows = this.rows.filter((row) => !toDelete.has(row.id))
  }

  public async countRows(where?: string): Promise<number> {
    return applyLanceWhere(this.rows, where || '').length
  }

  public query(): MemoryVectorQuery {
    return new MemoryVectorQuery(this.rows)
  }
}

class MemoryVectorCore {
  public readonly table: MemoryVectorTable

  public constructor(rows: VectorRow[] = []) {
    this.table = new MemoryVectorTable(rows)
  }

  public async openTable(): Promise<MemoryVectorTable> {
    return this.table
  }

  public escapeSqlString(value: string): string {
    return String(value || '').replace(/'/g, "''")
  }

  public buildInClause(column: string, values?: string[]): string | undefined {
    const list = (values || []).map((value) => String(value || '').trim()).filter(Boolean)
    if (list.length === 0) return undefined
    return `${column} IN (${list.map((value) => `'${this.escapeSqlString(value)}'`).join(',')})`
  }

  public combineWhere(parts: Array<string | undefined>): string | undefined {
    const clauses = parts.map((part) => String(part || '').trim()).filter(Boolean)
    if (clauses.length === 0) return undefined
    return clauses.map((part) => `(${part})`).join(' AND ')
  }

  public buildWhereFromQuery(): string | undefined {
    return undefined
  }
}

const applyLanceWhere = (rows: VectorRow[], where: string): VectorRow[] => {
  if (!where.trim()) return rows
  const eqMatches = Array.from(where.matchAll(/(\w+)\s*=\s*'([^']*)'/g))
  const inMatches = Array.from(where.matchAll(/(\w+)\s+IN\s+\(([^)]*)\)/g))
  return rows.filter((row) => {
    for (const match of eqMatches) {
      if (String(row[match[1]] || '') !== match[2]) return false
    }
    for (const match of inMatches) {
      const allowed = match[2]
        .split(',')
        .map((item) => item.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
      if (!allowed.includes(String(row[match[1]] || ''))) return false
    }
    return true
  })
}

const createSession = (id = 'session-1'): ChatSession => ({
  id,
  title: 'Test session',
  created_at: 1,
  workspace_id: 'workspace-1',
  pinned: false,
  pinned_at: null
})

const createRun = (input: Partial<AiRunRecord> = {}): AiRunRecord => ({
  id: input.id || 'run-1',
  sessionId: input.sessionId || 'session-1',
  userMessageId: input.userMessageId || 'user-1',
  assistantMessageId: input.assistantMessageId || 'assistant-1',
  status: input.status || 'running',
  input: input.input || 'hello',
  partialAnswer: input.partialAnswer || '',
  pendingApproval: input.pendingApproval,
  createdAt: input.createdAt || 10,
  updatedAt: input.updatedAt || 10,
  finishedAt: input.finishedAt
})

const createSessionUiState = (input = 'draft'): ChatSessionUiStateV1 => ({
  version: 1,
  composer: {
    mode: 'ai',
    aiPreference: 'local_sources_strict',
    executionPermission: 'review',
    modelSelection: {
      mainModel: { configId: 'provider-1', modelName: 'model-1' }
    },
    workspaceId: 'workspace-1',
    draft: {
      input,
      contentNodes: [{ kind: 'text', text: input }],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: false,
    fallbackState: {
      kind: 'search_list',
      title: '搜索结果',
      query: input,
      results: [],
      tokens: [input]
    }
  }
})

describe('sqlite storage core and stores', () => {
  let tempDir = ''
  let sqlite: SqliteCore
  let chatStore: ChatStore
  let chatSearchTurnStore: ChatSearchTurnStore
  let aiRunStore: AiRunStore

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-sqlite-storage-'))
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    chatStore = new ChatStore(sqlite)
    chatSearchTurnStore = new ChatSearchTurnStore(sqlite)
    aiRunStore = new AiRunStore(sqlite)
    await chatStore.saveChatSession(createSession())
  })

  afterEach(async () => {
    sqlite.close()
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('runs migrations once and is safe to initialize again', () => {
    sqlite.close()
    sqlite.initialize()
    sqlite.close()
    sqlite.initialize()

    const rows = sqlite
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string }>

    expect(rows).toEqual([
      { version: 1, name: 'initial_schema' },
      { version: 2, name: 'ai_runtime_system_notifications' },
      { version: 3, name: 'chat_session_skill_state' },
      { version: 4, name: 'reset_resume_snapshots_v2' },
      { version: 5, name: 'repair_false_docx_change_failures' },
      { version: 6, name: 'workbench_session_ui_state' },
      { version: 7, name: 'ai_run_execution_permission' },
      { version: 8, name: 'drop_llm_strategy_preference' },
      { version: 9, name: 'repair_ai_runtime_system_notifications_column' },
      { version: 10, name: 'upgrade_from_v9' }
    ])

    const legacyTables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('chat_session_resume_snapshot', 'chat_conversation_memory', 'ai_run_event')`
      )
      .all() as Array<{ name: string }>
    expect(legacyTables).toEqual([])
  })

  it('repairs notification settings after a historical migration version collision', async () => {
    sqlite.exec("UPDATE schema_migrations SET name = 'workspace_change_sets' WHERE version = 2")
    sqlite.exec('ALTER TABLE ai_runtime_settings DROP COLUMN systemNotificationsEnabled')
    repairAiRuntimeSystemNotificationsColumnMigration.run?.(sqlite.getConnection())
    sqlite.close()
    sqlite.initialize()

    const columns = sqlite.prepare('PRAGMA table_info(ai_runtime_settings)').all() as Array<{
      name: string
    }>
    const settingsStore = new AiRuntimeSettingsStore(sqlite)
    const saved = await settingsStore.save({
      llmStreamingMode: 'force_stream',
      systemNotificationsEnabled: false
    })

    expect(columns.some((column) => column.name === 'systemNotificationsEnabled')).toBe(true)
    expect(saved.systemNotificationsEnabled).toBe(false)
    expect(await settingsStore.get()).toMatchObject({ systemNotificationsEnabled: false })
  })

  it('persists versioned session UI state and rejects invalid writes', async () => {
    const store = new WorkbenchUiStore(sqlite)
    const initial = createSessionUiState('first draft')
    const replacement = createSessionUiState('replacement draft')

    await store.saveSessionState('session-1', initial)
    expect(await store.getSessionState('session-1')).toEqual(initial)

    await store.saveSessionState('session-1', replacement)
    expect(await store.getSessionState('session-1')).toEqual(replacement)
    await expect(store.saveSessionState('missing-session', initial)).rejects.toThrow(
      'chat session not found'
    )
    await expect(
      store.saveSessionState('session-1', {
        ...initial,
        version: 2
      } as unknown as ChatSessionUiStateV1)
    ).rejects.toThrow('invalid session UI state')

    sqlite
      .prepare('UPDATE chat_session_ui_state SET state_json = ? WHERE session_id = ?')
      .run('{broken-json', 'session-1')
    expect(await store.getSessionState('session-1')).toBeNull()
  })

  it('promotes draft UI and browser tabs with the first real session transaction', async () => {
    const workbenchStore = new WorkbenchUiStore(sqlite)
    const browserStore = new BrowserTabStateStore(sqlite)
    const draftState = createSessionUiState('unsent draft')
    await workbenchStore.saveWorkbenchState({ activeViewKey: '__draft__', draftState })
    browserStore.save({
      id: 'browser-draft-1',
      ownerId: '__draft__',
      title: 'Draft tab',
      url: 'https://example.com/second',
      zoomFactor: 1.25,
      history: {
        entries: [
          { title: 'First', url: 'https://example.com/first' },
          { title: 'Second', url: 'https://example.com/second' }
        ],
        index: 1
      },
      position: 0,
      createdAt: 10,
      updatedAt: 20
    })

    const promotedSession = createSession('session-promoted')
    await chatStore.saveChatSessionFromWorkbenchDraft(promotedSession)

    expect(await workbenchStore.getSessionState(promotedSession.id)).toEqual(draftState)
    expect(await workbenchStore.getWorkbenchState()).toMatchObject({
      activeViewKey: promotedSession.id,
      draftState: null
    })
    expect(browserStore.listByOwner('__draft__')).toEqual([])
    expect(browserStore.listByOwner(promotedSession.id)).toMatchObject([
      {
        id: 'browser-draft-1',
        url: 'https://example.com/second',
        zoomFactor: 1.25,
        history: { index: 1 },
        position: 0
      }
    ])
  })

  it('deletes session UI and browser state with its session', async () => {
    const workbenchStore = new WorkbenchUiStore(sqlite)
    const browserStore = new BrowserTabStateStore(sqlite)
    await workbenchStore.saveSessionState('session-1', createSessionUiState())
    await workbenchStore.saveWorkbenchState({
      activeViewKey: 'session-1',
      draftState: null
    })
    browserStore.save({
      id: 'browser-session-1',
      ownerId: 'session-1',
      url: 'https://example.com',
      zoomFactor: 0.9,
      position: 0,
      createdAt: 1,
      updatedAt: 1
    })

    await chatStore.deleteChatSession('session-1')

    expect(await workbenchStore.getSessionState('session-1')).toBeNull()
    expect(browserStore.listByOwner('session-1')).toEqual([])
    expect(await workbenchStore.getWorkbenchState()).toMatchObject({ activeViewKey: null })
  })

  it('repairs historical DOCX changes that were falsely marked as failed', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_file_change (
          id, session_id, run_id, status, capability, path, file_name, operation,
          change_count, insert_count, delete_count, before_checksum, after_checksum,
          created_at, updated_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'false-failure',
        'session-1',
        'run-1',
        'failed',
        'docx',
        '/workspace/input.docx',
        'input.docx',
        'updated',
        1,
        1,
        1,
        'before',
        'after',
        1,
        2,
        'Run completed without an effective workspace change.'
      )
    sqlite
      .prepare(
        `INSERT INTO docx_apply (
          id, session_id, run_id, status, source_path, source_name, operation,
          change_count, insert_count, delete_count, before_exists,
          before_checksum, after_checksum, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'false-failure',
        'session-1',
        'run-1',
        'applied',
        '/workspace/input.docx',
        'input.docx',
        'updated',
        1,
        1,
        1,
        1,
        'before',
        'after',
        1,
        2
      )

    sqlite.exec(repairFalseDocxChangeFailuresMigration.sql || '')

    const repaired = sqlite
      .prepare('SELECT status, last_error FROM ai_file_change WHERE id = ?')
      .get('false-failure') as { status: string; last_error: string | null }
    expect(repaired).toEqual({ status: 'applied', last_error: null })
  })

  it('keeps search turn seq stable in ascending order', async () => {
    for (let index = 1; index <= 60; index += 1) {
      await chatSearchTurnStore.appendTurn({
        sessionId: 'session-1',
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `turn-${index}`,
        createdAt: index
      })
    }

    const turns = await chatSearchTurnStore.list('session-1')
    const seqRows = sqlite
      .prepare('SELECT id, seq FROM chat_search_turn WHERE session_id = ? ORDER BY seq ASC')
      .all('session-1') as Array<{ id: string; seq: number }>

    expect(seqRows[0]?.seq).toBe(1)
    expect(seqRows[59]?.seq).toBe(60)
    expect(turns).toHaveLength(60)
    expect(turns[0]?.content).toBe('turn-1')
    expect(turns[59]?.content).toBe('turn-60')
  })

  it('drops legacy chat tables after migration 10', async () => {
    const chatMessage = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_message')
    const skillState = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_session_skill_state')
    const searchTurn = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_search_turn')
    expect(chatMessage).toBeUndefined()
    expect(skillState).toBeUndefined()
    expect(searchTurn).toBeDefined()
  })

  it('restores active and pending approval runs from sqlite', async () => {
    const pendingApproval: Extract<AiRunEvent, { type: 'approval_batch_required' }> = {
      type: 'approval_batch_required',
      runId: 'run-1',
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [],
      createdAt: 11
    }
    await aiRunStore.saveRun(createRun({ status: 'waiting_approval', pendingApproval }))

    const runs = await aiRunStore.listRunsBySession('session-1', ['running', 'waiting_approval'])

    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('waiting_approval')
    expect(runs[0].pendingApproval?.batchId).toBe('batch-1')
  })

  it('tracks completed sessions as unread until viewed after completion', async () => {
    await aiRunStore.saveRun(
      createRun({ status: 'completed', createdAt: 10, updatedAt: 20, finishedAt: 20 })
    )

    expect(await chatStore.listUnreadCompletedSessionIds()).toEqual(['session-1'])

    await chatStore.markChatSessionViewed('session-1', 21)

    expect(await chatStore.listUnreadCompletedSessionIds()).toEqual([])
  })

  it('pins sessions to the front of the list and restores them on unpin', async () => {
    await chatStore.saveChatSession(createSession('session-2'))
    await chatStore.setChatSessionPinned('session-1', true)

    const pinned = await chatStore.getChatSessions()
    expect(pinned.map((session) => session.id)).toEqual(['session-1', 'session-2'])
    expect(pinned[0]).toMatchObject({
      id: 'session-1',
      pinned: true
    })
    expect(pinned[0].pinned_at).toEqual(expect.any(Number))

    await chatStore.setChatSessionPinned('session-1', false)
    const unpinned = await chatStore.getChatSessions()
    expect(unpinned.map((session) => session.id)).toEqual(['session-2', 'session-1'])
    expect(unpinned.find((session) => session.id === 'session-1')).toMatchObject({
      pinned: false,
      pinned_at: null
    })
  })

  it('commits approval decision and clears pending approval', async () => {
    const pendingApproval: Extract<AiRunEvent, { type: 'approval_batch_required' }> = {
      type: 'approval_batch_required',
      runId: 'run-1',
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [{ itemId: 'item-1', title: 'Approve', description: 'Approve it' }],
      createdAt: 11
    }
    await aiRunStore.saveRun(createRun({ status: 'waiting_approval', pendingApproval }))

    const result = await aiRunStore.decideApprovalBatchTransaction({
      runId: 'run-1',
      request: {
        runId: 'run-1',
        batchId: 'batch-1',
        decisions: [{ itemId: 'item-1', action: 'approve' }]
      }
    })

    const run = await aiRunStore.getRun('run-1')

    expect(result.ok).toBe(true)
    expect(run?.status).toBe('running')
    expect(run?.pendingApproval).toBeUndefined()
  })
})

describe('sqlite document metadata with vector chunks', () => {
  let tempDir = ''
  let sqlite: SqliteCore

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-documents-store-'))
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
  })

  afterEach(async () => {
    sqlite.close()
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('writes chunks in 128-row batches', async () => {
    const vectorCore = new MemoryVectorCore()
    const store = new DocumentsStore(sqlite, vectorCore as unknown as LanceDbCore)
    const chunks = Array.from({ length: 260 }, (_, index) => ({
      id: `chunk-${index}`,
      text: `chunk text ${index}`,
      document_id: 'document-1',
      workspace_id: 'workspace-1',
      document_name: 'Document',
      source_type: 'file',
      metadata: { page: 1 }
    }))
    const vectors = chunks.map(() => Float32Array.from([0, 0, 0]))

    await store.addChunks({ chunks, vectors, generationId: 'generation-1' })

    expect(vectorCore.table.addBatches.map((batch) => batch.length)).toEqual([128, 128, 4])
  })

  it('lists only active generation chunks', async () => {
    const vectorCore = new MemoryVectorCore([
      {
        id: 'active-chunk',
        text: 'active text',
        document_id: 'document-1',
        workspace_id: 'workspace-1',
        source_type: 'file',
        generation_id: 'generation-active',
        document_name: 'Document',
        metadata: { page: 1 },
        created_at: 1,
        vector: [1, 2, 3]
      },
      {
        id: 'old-chunk',
        text: 'old text',
        document_id: 'document-1',
        workspace_id: 'workspace-1',
        source_type: 'file',
        generation_id: 'generation-old',
        document_name: 'Document',
        metadata: { page: 1 },
        created_at: 1,
        vector: [1, 2, 3]
      }
    ])
    const store = new DocumentsStore(sqlite, vectorCore as unknown as LanceDbCore)
    await store.addDocument({
      id: 'document-1',
      name: 'Document',
      source_type: 'file',
      workspace_id: 'workspace-1',
      file_path: '/tmp/document.txt',
      created_at: 1,
      import_status: 2,
      active_generation_id: 'generation-active'
    })

    const result = await store.listChunks({
      workspaceId: 'workspace-1',
      page: 1,
      pageSize: 10
    })

    expect(result.total).toBe(1)
    expect(result.items.map((item) => item.id)).toEqual(['active-chunk'])
  })
})

describe('storage service initialization', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-storage-service-'))
  })

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('initializes sqlite and the vector chunk table together', async () => {
    const service = new StorageService({
      sqlitePath: path.join(tempDir, 'app.sqlite'),
      vectorPath: path.join(tempDir, 'lancedb')
    })

    try {
      await service.initialize()

      expect(service.sqlite.getConnection().open).toBe(true)
      expect(await service.vector.tableExists('vector_chunk')).toBe(true)
    } finally {
      await service.close()
    }
  })
})
