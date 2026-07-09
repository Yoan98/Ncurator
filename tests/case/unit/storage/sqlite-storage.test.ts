import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiRunEvent, AiRunRecord, ChatMessage, ChatSession } from '../../../../src/shared/types'
import { LanceDbCore } from '../../../../src/main/services/storage/core/LanceDbCore'
import { ChatStore } from '../../../../src/main/services/storage/domains/ChatStore'
import { AiRunStore } from '../../../../src/main/services/storage/domains/AiRunStore'
import { DocumentsStore } from '../../../../src/main/services/storage/domains/DocumentsStore'
import { StorageService } from '../../../../src/main/services/storage/StorageService'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'

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
  workspace_id: 'workspace-1'
})

const createMessage = (input: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage => ({
  id: input.id,
  session_id: input.session_id || 'session-1',
  role: input.role || 'user',
  content: input.content || input.id,
  timestamp: input.timestamp
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
  eventCount: input.eventCount,
  visibleEventCount: input.visibleEventCount,
  lastEventAt: input.lastEventAt,
  createdAt: input.createdAt || 10,
  updatedAt: input.updatedAt || 10,
  finishedAt: input.finishedAt
})

describe('sqlite storage core and stores', () => {
  let tempDir = ''
  let sqlite: SqliteCore
  let chatStore: ChatStore
  let aiRunStore: AiRunStore

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-sqlite-storage-'))
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    chatStore = new ChatStore(sqlite)
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

    expect(rows).toEqual([{ version: 1, name: 'initial_schema' }])
  })

  it('keeps chat message seq stable and returns the latest 50 in ascending order', async () => {
    for (let index = 1; index <= 60; index += 1) {
      await chatStore.saveChatMessage(createMessage({ id: `message-${index}`, timestamp: index }))
    }

    const page = await chatStore.getChatMessagesPage({ sessionId: 'session-1', limit: 50 })
    const seqRows = sqlite
      .prepare('SELECT id, seq FROM chat_message WHERE session_id = ? ORDER BY seq ASC')
      .all('session-1') as Array<{ id: string; seq: number }>

    expect(seqRows[0]).toEqual({ id: 'message-1', seq: 1 })
    expect(seqRows[59]).toEqual({ id: 'message-60', seq: 60 })
    expect(page.hasMoreBefore).toBe(true)
    expect(page.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `message-${index + 11}`)
    )
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

  it('commits approval decision, clears pending approval, and keeps event seq unique', async () => {
    const pendingApproval: Extract<AiRunEvent, { type: 'approval_batch_required' }> = {
      type: 'approval_batch_required',
      runId: 'run-1',
      taskId: 'task-1',
      batchId: 'batch-1',
      items: [{ itemId: 'item-1', title: 'Approve', description: 'Approve it' }],
      createdAt: 11
    }
    await aiRunStore.saveRun(createRun({ status: 'waiting_approval', pendingApproval }))
    await aiRunStore.appendEvent({
      runId: 'run-1',
      sessionId: 'session-1',
      event: pendingApproval
    })

    const result = await aiRunStore.decideApprovalBatchTransaction({
      runId: 'run-1',
      request: {
        runId: 'run-1',
        batchId: 'batch-1',
        decisions: [{ itemId: 'item-1', action: 'approve' }]
      },
      event: {
        type: 'approval_batch_decision',
        runId: 'run-1',
        taskId: 'task-1',
        batchId: 'batch-1',
        decisions: [{ itemId: 'item-1', action: 'approve' }],
        decidedAt: 12
      }
    })

    const run = await aiRunStore.getRun('run-1')
    const events = await aiRunStore.listEvents('run-1')

    expect(result.ok).toBe(true)
    expect(run?.status).toBe('running')
    expect(run?.pendingApproval).toBeUndefined()
    expect(events.map((event) => event.seq)).toEqual([1, 2])
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length)
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
