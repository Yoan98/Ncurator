import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AiRunEvent,
  AiRunRecord,
  Partner,
  PartnerUiStateV1
} from '../../../../src/shared/types'
import { LanceDbCore } from '../../../../src/main/services/storage/core/LanceDbCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
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

  public buildNotInClause(column: string, values?: string[]): string | undefined {
    const list = (values || []).map((value) => String(value || '').trim()).filter(Boolean)
    if (list.length === 0) return undefined
    return `${column} NOT IN (${list.map((value) => `'${this.escapeSqlString(value)}'`).join(',')})`
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
  const neqMatches = Array.from(where.matchAll(/(\w+)\s*!=\s*'([^']*)'/g))
  const eqMatches = Array.from(where.matchAll(/(\w+)\s*=\s*'([^']*)'/g)).filter(
    (match) => !where.slice(Math.max(0, (match.index || 0) - 1), match.index).includes('!')
  )
  const notInMatches = Array.from(where.matchAll(/(\w+)\s+NOT IN\s+\(([^)]*)\)/g))
  const inMatches = Array.from(where.matchAll(/(\w+)\s+IN\s+\(([^)]*)\)/g)).filter((match) => {
    if (match[1].toUpperCase() === 'NOT') return false
    const prefix = where.slice(Math.max(0, (match.index || 0) - 4), match.index || 0)
    return !/NOT\s*$/i.test(prefix)
  })
  const requireId = /id\s+IS NOT NULL/i.test(where)
  return rows.filter((row) => {
    if (requireId && (row.id == null || String(row.id) === '')) return false
    for (const match of neqMatches) {
      if (String(row[match[1]] || '') === match[2]) return false
    }
    for (const match of eqMatches) {
      if (String(row[match[1]] || '') !== match[2]) return false
    }
    for (const match of notInMatches) {
      const blocked = match[2]
        .split(',')
        .map((item) => item.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
      if (blocked.includes(String(row[match[1]] || ''))) return false
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

const createPartner = (id = 'partner-1'): Partner => ({
  id,
  name: 'Test partner',
  avatar_shape: 'circle',
  avatar_color: 'blue',
  created_at: 1,
  updated_at: 1,
  last_viewed_at: 1,
  pinned: false,
  pinned_at: null
})

const createRun = (input: Partial<AiRunRecord> = {}): AiRunRecord => ({
  id: input.id || 'run-1',
  partnerId: input.partnerId || 'partner-1',
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

const createPartnerUiState = (input = 'draft'): PartnerUiStateV1 => ({
  version: 1,
  composer: {
    aiPreference: 'local_sources_strict',
    executionPermission: 'review',
    modelSelection: {
      mainModel: { configId: 'provider-1', modelName: 'model-1' }
    },
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
      kind: 'empty',
      title: '',
      description: ''
    }
  }
})

describe('sqlite storage core and stores', () => {
  let tempDir = ''
  let sqlite: SqliteCore
  let partnerStore: PartnerStore
  let aiRunStore: AiRunStore

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-sqlite-storage-'))
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    partnerStore = new PartnerStore(sqlite)
    aiRunStore = new AiRunStore(sqlite)
    await partnerStore.savePartner(createPartner())
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
      { version: 10, name: 'upgrade_from_v9' },
      { version: 11, name: 'ai_run_failure_raw_message' }
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

  it('persists versioned partner UI state and rejects invalid writes', async () => {
    const store = new WorkbenchUiStore(sqlite)
    const initial = createPartnerUiState('first draft')
    const replacement = createPartnerUiState('replacement draft')

    await store.savePartnerState('partner-1', initial)
    expect(await store.getPartnerState('partner-1')).toEqual(initial)

    await store.savePartnerState('partner-1', replacement)
    expect(await store.getPartnerState('partner-1')).toEqual(replacement)
    await expect(store.savePartnerState('missing-partner', initial)).rejects.toThrow(
      'partner not found'
    )
    await expect(
      store.savePartnerState('partner-1', {
        ...initial,
        version: 2
      } as unknown as PartnerUiStateV1)
    ).rejects.toThrow('invalid partner UI state')

    sqlite
      .prepare('UPDATE partner_ui_state SET state_json = ? WHERE partner_id = ?')
      .run('{broken-json', 'partner-1')
    expect(await store.getPartnerState('partner-1')).toBeNull()
  })

  it('keeps partner UI and browser tabs on the same partner without draft promotion', async () => {
    const workbenchStore = new WorkbenchUiStore(sqlite)
    const browserStore = new BrowserTabStateStore(sqlite)
    const partnerState = createPartnerUiState('unsent draft')
    await workbenchStore.savePartnerState('partner-1', partnerState)
    await workbenchStore.saveWorkbenchState({ activeViewKey: 'partner-1' })
    browserStore.save({
      id: 'browser-partner-1',
      ownerId: 'partner-1',
      title: 'Partner tab',
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

    expect(await workbenchStore.getPartnerState('partner-1')).toEqual(partnerState)
    expect(await workbenchStore.getWorkbenchState()).toMatchObject({
      activeViewKey: 'partner-1'
    })
    expect(browserStore.listByOwner('partner-1')).toMatchObject([
      {
        id: 'browser-partner-1',
        url: 'https://example.com/second',
        zoomFactor: 1.25,
        history: { index: 1 },
        position: 0
      }
    ])
  })

  it('deletes partner UI and browser state with its partner', async () => {
    const workbenchStore = new WorkbenchUiStore(sqlite)
    const browserStore = new BrowserTabStateStore(sqlite)
    await workbenchStore.savePartnerState('partner-1', createPartnerUiState())
    await workbenchStore.saveWorkbenchState({
      activeViewKey: 'partner-1'
    })
    browserStore.save({
      id: 'browser-partner-1',
      ownerId: 'partner-1',
      url: 'https://example.com',
      zoomFactor: 0.9,
      position: 0,
      createdAt: 1,
      updatedAt: 1
    })

    await partnerStore.deletePartner('partner-1')

    expect(await workbenchStore.getPartnerState('partner-1')).toBeNull()
    expect(browserStore.listByOwner('partner-1')).toEqual([])
    expect(await workbenchStore.getWorkbenchState()).toMatchObject({ activeViewKey: null })
  })

  it('repairs historical DOCX changes that were falsely marked as failed', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_file_change (
          id, partner_id, run_id, status, capability, path, file_name, operation,
          change_count, insert_count, delete_count, before_checksum, after_checksum,
          created_at, updated_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'false-failure',
        'partner-1',
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
          id, partner_id, run_id, status, source_path, source_name, operation,
          final_revision_ref, change_count, insert_count, delete_count, before_exists,
          before_checksum, after_checksum, preview_diff_artifact_path, preview_diff_checksum,
          preview_diff_byte_size, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'false-failure',
        'partner-1',
        'run-1',
        'applied',
        '/workspace/input.docx',
        'input.docx',
        'updated',
        'rev-1',
        1,
        1,
        1,
        1,
        'before',
        'after',
        '/tmp/preview.diff',
        'preview-checksum',
        1,
        1,
        2
      )

    sqlite.exec(repairFalseDocxChangeFailuresMigration.sql || '')

    const repaired = sqlite
      .prepare('SELECT status, last_error FROM ai_file_change WHERE id = ?')
      .get('false-failure') as { status: string; last_error: string | null }
    expect(repaired).toEqual({ status: 'applied', last_error: null })
  })

  it('does not create chat_search_turn after migration 10', async () => {
    const chatMessage = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_message')
    const skillState = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_session_skill_state')
    const searchTurn = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('chat_search_turn')
    const partner = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('partner')
    expect(chatMessage).toBeUndefined()
    expect(skillState).toBeUndefined()
    expect(searchTurn).toBeUndefined()
    expect(partner).toBeDefined()
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

    const runs = await aiRunStore.listRunsByPartner('partner-1', ['running', 'waiting_approval'])

    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('waiting_approval')
    expect(runs[0].pendingApproval?.batchId).toBe('batch-1')
  })

  it('tracks completed partners as unread until viewed after completion', async () => {
    await aiRunStore.saveRun(
      createRun({ status: 'completed', createdAt: 10, updatedAt: 20, finishedAt: 20 })
    )

    expect(await partnerStore.listUnreadCompletedPartnerIds()).toEqual(['partner-1'])

    await partnerStore.markPartnerViewed('partner-1', 21)

    expect(await partnerStore.listUnreadCompletedPartnerIds()).toEqual([])
  })

  it('pins partners to the front of the list and restores them on unpin', async () => {
    await partnerStore.savePartner(createPartner('partner-2'))
    await partnerStore.setPartnerPinned('partner-1', true)

    const pinned = await partnerStore.listPartners()
    expect(pinned.map((partner) => partner.id)).toEqual(['partner-1', 'partner-2'])
    expect(pinned[0]).toMatchObject({
      id: 'partner-1',
      pinned: true
    })
    expect(pinned[0].pinned_at).toEqual(expect.any(Number))

    await partnerStore.setPartnerPinned('partner-1', false)
    const unpinned = await partnerStore.listPartners()
    expect(unpinned.map((partner) => partner.id).sort()).toEqual(['partner-1', 'partner-2'])
    expect(unpinned.find((partner) => partner.id === 'partner-1')).toMatchObject({
      pinned: false,
      pinned_at: null
    })
  })

  it('updates partner name and avatar without resetting pin', async () => {
    await partnerStore.setPartnerPinned('partner-1', true)
    const pinned = await partnerStore.getPartner('partner-1')
    await partnerStore.savePartner({
      ...(pinned || createPartner()),
      name: 'Renamed partner',
      avatar_shape: 'pill',
      avatar_color: 'orange'
    })

    const updated = await partnerStore.getPartner('partner-1')
    expect(updated).toMatchObject({
      id: 'partner-1',
      name: 'Renamed partner',
      avatar_shape: 'pill',
      avatar_color: 'orange',
      pinned: true
    })
  })

  it('returns the latest user input preview for each partner', async () => {
    await partnerStore.savePartner(createPartner('partner-2'))
    await aiRunStore.saveRun(
      createRun({
        id: 'run-1',
        partnerId: 'partner-1',
        input: 'first question',
        createdAt: 10
      })
    )
    await aiRunStore.saveRun(
      createRun({
        id: 'run-2',
        partnerId: 'partner-1',
        userMessageId: 'user-2',
        assistantMessageId: 'assistant-2',
        input: 'latest question',
        createdAt: 20
      })
    )
    await aiRunStore.saveRun(
      createRun({
        id: 'run-3',
        partnerId: 'partner-2',
        userMessageId: 'user-3',
        assistantMessageId: 'assistant-3',
        input: 'a'.repeat(48),
        createdAt: 15
      })
    )

    const latest = await aiRunStore.listLatestUserInputs()

    expect(latest.get('partner-1')).toEqual({
      preview: 'latest question',
      createdAt: 20
    })
    expect(latest.get('partner-2')).toEqual({
      preview: `${'a'.repeat(40)}…`,
      createdAt: 15
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

  it('purges stale generation and orphan chunks without using search filters', async () => {
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
      },
      {
        id: 'orphan-chunk',
        text: 'orphan text',
        document_id: 'missing-document',
        workspace_id: 'workspace-1',
        source_type: 'file',
        generation_id: 'generation-orphan',
        document_name: 'Missing',
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

    const beforePurge = await store.listChunks({
      workspaceId: 'workspace-1',
      page: 1,
      pageSize: 10
    })
    expect(beforePurge.items.map((item) => item.id).sort()).toEqual([
      'active-chunk',
      'old-chunk',
      'orphan-chunk'
    ])

    await store.purgeStaleChunks()

    const afterPurge = await store.listChunks({
      workspaceId: 'workspace-1',
      page: 1,
      pageSize: 10
    })
    expect(afterPurge.items.map((item) => item.id)).toEqual(['active-chunk'])
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

  it('purges leftover lancedb files when the v10 afterCommit hook runs', async () => {
    const vectorPath = path.join(tempDir, 'lancedb')
    const leftoverPath = path.join(vectorPath, 'stale-vector-data')
    await fs.mkdir(vectorPath, { recursive: true })
    await fs.writeFile(leftoverPath, 'old-chunks')

    const service = new StorageService({
      sqlitePath: path.join(tempDir, 'app.sqlite'),
      vectorPath
    })

    try {
      await service.initialize()
      await expect(fs.access(leftoverPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await service.vector.tableExists('vector_chunk')).toBe(true)
    } finally {
      await service.close()
    }
  })
})
