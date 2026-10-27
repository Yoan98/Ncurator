import { OpenWithPreferenceStore } from '../../../../src/main/services/storage/domains/OpenWithPreferenceStore'
import { LlmConfigStore } from '../../../../src/main/services/storage/domains/LlmConfigStore'
import { projectMessageLogRecords } from '../../../../src/main/services/ai/human/memory/transcript'
import { ChatMessageLogStore } from '../../../../src/main/services/storage/domains/ChatMessageLogStore'
import { AiSubagentStore } from '../../../../src/main/services/storage/domains/AiSubagentStore'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { AppSettingsStore } from '../../../../src/main/services/storage/domains/AppSettingsStore'
import { repairFalseDocxChangeFailuresMigration } from '../../../../src/main/services/storage/sqlite/migrations/005_repair_false_docx_change_failures'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { LOCAL_EMBEDDING_MODEL_ID } from '../../../../src/shared/embeddingModels'
import type { EmbeddingExecutor } from '../../../../src/main/services/vector/runtime/types'
import { WorkspaceKnowledgePrepareService } from '../../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { IndexPrepareCancelledError } from '../../../../src/main/services/workspace/WorkspaceIndexPrepareController'
import { prepareWorkspaceSource } from '../../../../src/main/services/workspace/worker/workspacePrepareWorker'

const createPartner = (id = 'partner-1'): Partner => ({
  id,
  name: id === 'partner-1' ? 'Test partner' : `Test partner ${id}`,
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
      formatVersion: 2,
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

  it('keeps exact manual model names with their service through edits and reopening the database', async () => {
    const store = new LlmConfigStore(sqlite)
    const config = {
      id: 'manual-service',
      name: 'test',
      providerKind: 'openai-compatible' as const,
      base_url: 'http://localhost:9000/v1',
      api_key: 'local-key'
    }
    await store.save(config)
    await store.addManualModel(config.id, '  Manual.Model  ')
    await store.addManualModel(config.id, 'Manual.Model')
    await store.addManualModel(config.id, 'manual.model')
    await store.save({ ...config, name: 'renamed', api_key: 'new-key' })
    await store.save({ ...config, id: 'another-service', name: 'other' })
    await expect(store.addManualModel(config.id, '   ')).rejects.toThrow('请输入模型名称')
    await expect(store.addManualModel('missing', 'model')).rejects.toThrow('配置不存在')
    sqlite.close()
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    const reopened = new LlmConfigStore(sqlite)
    expect(await reopened.getById(config.id)).toMatchObject({
      name: 'renamed',
      api_key: 'new-key',
      manualModels: ['Manual.Model', 'manual.model']
    })
    expect((await reopened.getById('another-service'))?.manualModels).toEqual([])
    await reopened.delete(config.id)
    await reopened.save(config)
    expect((await reopened.getById(config.id))?.manualModels).toEqual([])
  })

  it('roundtrips legacy loader annotations without reviving or erasing independent current snapshots', async () => {
    const insertRawEntry = (seq: number, entryJson: string) =>
      sqlite
        .prepare(
          `
        INSERT INTO chat_session_message_log
          (id, partner_id, subagent_id, run_id, seq, entry_json, created_at)
        VALUES (?, 'partner-1', NULL, 'restore-run', ?, ?, ?)
      `
        )
        .run(`raw-log-${seq}`, seq, entryJson, seq)
    const legacyEntry = JSON.stringify({
      kind: 'annotation',
      eventType: 'skill_state_updated',
      payload: { learnedSkillIds: ['docx-read', 'user:stale'] }
    })
    insertRawEntry(1, legacyEntry)
    const logs = new ChatMessageLogStore(sqlite)
    const historicalRecords = await logs.list('partner-1')
    expect(historicalRecords).toHaveLength(1)
    expect(() => projectMessageLogRecords(historicalRecords)).not.toThrow()
    expect(projectMessageLogRecords(historicalRecords)).toMatchObject({
      loadedToolsetIds: [],
      loadedSkillNames: []
    })

    await logs.appendBatch({
      partnerId: 'partner-1',
      runId: 'restore-run',
      entries: [
        {
          kind: 'annotation',
          eventType: 'toolset_state_updated',
          payload: { loadedToolsetIds: ['docx-read'] }
        },
        {
          kind: 'annotation',
          eventType: 'skill_state_updated',
          payload: { loadedSkillNames: ['user:current'] }
        }
      ]
    })
    // Old/invalid records after valid snapshots cannot erase or cross-populate their state.
    insertRawEntry(4, legacyEntry)
    insertRawEntry(
      5,
      JSON.stringify({
        kind: 'annotation',
        eventType: 'skill_state_updated',
        payload: { loadedSkillNames: 'user:stale' }
      })
    )
    insertRawEntry(
      6,
      JSON.stringify({
        kind: 'annotation',
        eventType: 'toolset_state_updated',
        payload: { loadedToolsetIds: null }
      })
    )
    sqlite.close()
    sqlite.initialize()
    const restoredRecords = await new ChatMessageLogStore(sqlite).list('partner-1')
    expect(restoredRecords.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(restoredRecords[3].entry).toEqual(JSON.parse(legacyEntry))
    expect(() => projectMessageLogRecords(restoredRecords)).not.toThrow()
    expect(projectMessageLogRecords(restoredRecords)).toMatchObject({
      loadedToolsetIds: ['docx-read'],
      loadedSkillNames: ['user:current']
    })
  })

  it('persists extension application preferences across reopening SQLite', () => {
    const preferences = new OpenWithPreferenceStore(sqlite)
    preferences.set('.docx', 'wps')
    preferences.set('.md', 'editor')
    sqlite.close()
    sqlite.initialize()
    const restored = new OpenWithPreferenceStore(sqlite)
    expect(restored.get('.docx')).toBe('wps')
    expect(restored.get('.md')).toBe('editor')
    restored.set('.docx', null)
    expect(restored.get('.docx')).toBeUndefined()
    expect(restored.get('.md')).toBe('editor')
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
      { version: 11, name: 'drop_terminal_file_change_records' },
      { version: 12, name: 'app_settings' },
      { version: 13, name: 'ai_run_pending_interaction' },
      { version: 14, name: 'scheduled_task_partner_binding' },
      { version: 15, name: 'ai_run_pending_messages' },
      { version: 16, name: 'subagent_sessions' },
      { version: 17, name: 'open_with_preferences' },
      { version: 18, name: 'app_language_and_service_route' },
      { version: 19, name: 'user_skills' },
      { version: 20, name: 'skill_name_bindings' },
      { version: 21, name: 'embedding_models' },
      { version: 22, name: 'llm_manual_models' }
    ])

    const legacyTables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('chat_session_resume_snapshot', 'chat_conversation_memory', 'ai_run_event')`
      )
      .all() as Array<{ name: string }>
    expect(legacyTables).toEqual([])
  })

  it('persists app settings after replacing the legacy runtime settings table', async () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('app_settings', 'ai_runtime_settings')"
      )
      .all() as Array<{ name: string }>
    const settingsStore = new AppSettingsStore(sqlite)
    const saved = await settingsStore.save({
      systemNotificationsEnabled: false,
      knowledgeIndexSpeed: 'fast',
      language: 'system',
      serviceRoute: 'domestic'
    })

    expect(tables).toEqual([{ name: 'app_settings' }])
    expect(saved).toEqual({
      systemNotificationsEnabled: false,
      knowledgeIndexSpeed: 'fast',
      language: 'system',
      serviceRoute: 'domestic'
    })
    expect(await settingsStore.get()).toEqual({
      systemNotificationsEnabled: false,
      knowledgeIndexSpeed: 'fast',
      language: 'system',
      serviceRoute: 'domestic'
    })
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

  it('rejects duplicate partner names on create and rename while allowing the current name', async () => {
    expect(() =>
      partnerStore.savePartner({ ...createPartner('partner-2'), name: ' Test partner ' })
    ).toThrow('伙伴名称已存在')
    await partnerStore.savePartner(createPartner('partner-2'))
    expect(() =>
      partnerStore.savePartner({ ...createPartner('partner-2'), name: 'Test partner' })
    ).toThrow('伙伴名称已存在')
    await partnerStore.savePartner({ ...createPartner(), name: ' test partner ' })
    expect((await partnerStore.getPartner('partner-1'))?.name).toBe('test partner')
    expect((await partnerStore.listPartners()).length).toBe(2)
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
  let vector: LanceDbCore
  let documents: DocumentsStore
  const localVector = Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
  const embeddings: EmbeddingService[] = []

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-documents-store-'))
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    vector = new LanceDbCore(path.join(tempDir, 'lancedb'))
    await vector.initialize()
    documents = new DocumentsStore(sqlite, vector)
  })

  afterEach(async () => {
    for (const embedding of embeddings.splice(0)) await embedding.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await vector.close()
    sqlite.close()
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  const seed = async (
    id = 'document-1',
    texts = ['quartz first paragraph', 'quartz second paragraph'],
    sourceType: 'file' | 'web' = 'file'
  ) => {
    await documents.addDocument({
      id,
      name: id,
      source_type: sourceType,
      workspace_id: 'workspace-1',
      file_path: path.join(tempDir, 'missing-source', id + '.txt'),
      created_at: 1,
      import_status: 2,
      active_generation_id: 'generation-1',
      content_hash: 'hash-1'
    })
    await documents.addChunks({
      chunks: texts.map((text, chunk_index) => ({
        id: id + '-chunk-' + chunk_index,
        text,
        document_id: id,
        workspace_id: 'workspace-1',
        document_name: id,
        source_type: sourceType,
        metadata: { page: 1 },
        chunk_index
      })),
      vectors: texts.map(() => localVector),
      generationId: 'generation-1'
    })
  }
  const waitFor = async <T>(pending: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const readActiveChunks = async (documentId: string) => {
    const document = await documents.getDocumentById(documentId)
    if (!document?.active_generation_id || document.embedding_dim === 0) return []
    const table = await vector.openChunkTable(document.embedding_identity!, document.embedding_dim!)
    expect(table).not.toBeNull()
    const rows = await table!
      .query()
      .where(
        `document_id = '${vector.escapeSqlString(documentId)}' AND generation_id = '${vector.escapeSqlString(document.active_generation_id)}'`
      )
      .toArray()
    return rows
      .map((row) => ({
        id: String(row.id),
        text: String(row.text),
        document_id: String(row.document_id),
        document_name: String(row.document_name),
        workspace_id: String(row.workspace_id),
        source_type: String(row.source_type),
        metadata: { page: Number((row.metadata as { page: number }).page) },
        generation_id: String(row.generation_id),
        chunk_index: Number(row.chunk_index)
      }))
      .sort((left, right) => left.chunk_index - right.chunk_index)
  }

  const prepareCancellationFixture = async (
    sourceType: 'file' | 'web',
    status = 2,
    previousError: string | null = 'previous import diagnostic'
  ) => {
    await seed('document-1', undefined, sourceType)
    const filePath = path.join(tempDir, 'missing-source', 'document-1.txt')
    const sourceUrl = 'https://workspace.example.invalid/cancellation'
    const newText = 'zircon replacement body prepared before cancellation'
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, newText)
    await documents.updateDocumentImportStatus('document-1', status)
    await documents.updateDocumentById('document-1', {
      file_path: sourceType === 'file' ? filePath : sourceUrl,
      last_error: previousError
    })
    const previous = await documents.getDocumentById('document-1')
    expect(previous).toMatchObject({
      import_status: status,
      content_hash: 'hash-1',
      last_error: previousError ?? undefined
    })
    const previousChunks = await readActiveChunks('document-1')
    const executor: EmbeddingExecutor = {
      initialize: async () => undefined,
      embed: async (texts) => ({
        data: Float32Array.from(texts.flatMap(() => Array.from(localVector))),
        dims: [texts.length, localVector.length]
      })
    }
    const embeddingService = new EmbeddingService({ executor })
    embeddings.push(embeddingService)
    const prepareIdentity = 'remote:prepare-cancellation-unit'
    await embeddingService.configure({
      executor,
      modelName: 'unit-768',
      identity: prepareIdentity,
      kind: 'remote',
      maxInputTokens: 512
    })
    const prepare = new WorkspaceKnowledgePrepareService({
      documentsStore: documents,
      embeddingService,
      prepareSource: prepareWorkspaceSource
    })
    const abort = new AbortController()
    const index = () => {
      const common = {
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        documentName: 'document-1',
        signal: abort.signal
      }
      return sourceType === 'file'
        ? prepare.indexLocalFile({ ...common, filePath })
        : prepare.indexWebText({
            ...common,
            sourceType: 'web',
            sourceUrl,
            rawText: newText,
            contentHash: 'hash-new-web'
          })
    }
    return { prepare, abort, index, previous, previousChunks, newText, prepareIdentity }
  }

  it.each([
    ['file', 2, 'previous import diagnostic'],
    ['file', 3, 'previous import diagnostic'],
    ['web', 2, 'previous import diagnostic'],
    ['web', 3, 'previous import diagnostic'],
    ['file', 2, null],
    ['web', 3, null]
  ] as const)(
    'restores the active %s document with status %s and error %s after cancellation following a real chunk write',
    async (sourceType, status, previousError) => {
      const fixture = await prepareCancellationFixture(sourceType, status, previousError)
      const addChunks = documents.addChunks.bind(documents)
      const activate = vi.spyOn(documents, 'activateDocumentGeneration')
      let stagedGeneration: string | undefined
      let writtenRows = 0
      // 取消只发生在真实 addChunks 返回之后，避免持有 LanceDB 内部写锁等待清理。
      //
      // Abort only after the real addChunks returns, avoiding a wait for cleanup while holding a LanceDB write lock.
      const write = vi.spyOn(documents, 'addChunks').mockImplementation(async (input) => {
        await addChunks(input)
        stagedGeneration = input.generationId
        const table = (await vector.openChunkTable(fixture.prepareIdentity, 768))!
        writtenRows = await table.countRows(`generation_id = '${stagedGeneration}'`)
        fixture.abort.abort()
      })
      try {
        await expect(waitFor(fixture.index(), 'prepare cancellation')).rejects.toBeInstanceOf(
          IndexPrepareCancelledError
        )
        expect(write).toHaveBeenCalledTimes(1)
        expect(writtenRows).toBeGreaterThan(0)
        expect(stagedGeneration).not.toBe('generation-1')
        expect(activate).not.toHaveBeenCalled()
        const restored = await documents.getDocumentById('document-1')
        expect.soft(restored).toMatchObject({
          active_generation_id: fixture.previous!.active_generation_id,
          content_hash: fixture.previous!.content_hash,
          import_status: fixture.previous!.import_status,
          last_error: fixture.previous!.last_error,
          embedding_identity: fixture.previous!.embedding_identity,
          embedding_dim: fixture.previous!.embedding_dim,
          embedding_error: fixture.previous!.embedding_error
        })
        expect.soft(await readActiveChunks('document-1')).toEqual(fixture.previousChunks)
        expect
          .soft((await documents.ftsSearch('quartz')).map((row) => row.text).sort())
          .toEqual(fixture.previousChunks.map((row) => row.text).sort())
        const table = (await vector.openChunkTable(fixture.prepareIdentity, 768))!
        expect.soft(await table.countRows(`generation_id = '${stagedGeneration}'`)).toBe(0)
        expect(documents.getStaleEmbeddingDocumentIds(fixture.prepareIdentity)).toContain(
          'document-1'
        )
      } finally {
        write.mockRestore()
        activate.mockRestore()
        await fixture.prepare.abortActivePrepare()
      }
    }
  )

  it.each(['file', 'web'] as const)(
    'does not roll back an activated %s generation when cancellation arrives after commit',
    async (sourceType) => {
      const fixture = await prepareCancellationFixture(sourceType)
      const activate = documents.activateDocumentGeneration.bind(documents)
      let committedGeneration = ''
      const commit = vi
        .spyOn(documents, 'activateDocumentGeneration')
        .mockImplementation(async (input) => {
          await activate(input)
          committedGeneration = input.generationId
          fixture.abort.abort()
        })
      try {
        const indexed = await waitFor(fixture.index(), 'post-activation cancellation')
        expect(commit).toHaveBeenCalledTimes(1)
        expect(committedGeneration).not.toBe('generation-1')
        expect(await documents.getDocumentById('document-1')).toMatchObject({
          active_generation_id: committedGeneration,
          import_status: 2,
          last_error: undefined
        })
        const chunks = await readActiveChunks('document-1')
        expect(chunks.map(({ id, text }) => ({ id, text }))).toEqual(
          indexed.chunks.map(({ id, text }) => ({ id, text }))
        )
        expect(chunks.some((row) => row.text.includes(fixture.newText))).toBe(true)
        expect(
          chunks.every((row) => !fixture.previousChunks.some((old) => old.id === row.id))
        ).toBe(true)
        expect(chunks.every((row) => row.generation_id === committedGeneration)).toBe(true)
        const table = (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!
        expect(await table.countRows("generation_id = 'generation-1'")).toBe(0)
      } finally {
        commit.mockRestore()
        await fixture.prepare.abortActivePrepare()
      }
    }
  )

  it.each(['generation changed', 'hash changed', 'deleted'] as const)(
    'does not restore stale metadata when the document is %s before cancellation cleanup',
    async (change) => {
      const fixture = await prepareCancellationFixture('file', 3)
      const addChunks = documents.addChunks.bind(documents)
      let racedDocument: Awaited<ReturnType<DocumentsStore['getDocumentById']>>
      const write = vi.spyOn(documents, 'addChunks').mockImplementation(async (input) => {
        await addChunks(input)
        if (change === 'deleted') {
          // 仅删除 SQLite 元数据以制造并发删除；不在 generation 写闸内重入另一个写任务。
          //
          // Delete SQLite metadata to race cancellation without re-entering another writer inside the generation gate.
          sqlite.prepare('DELETE FROM document WHERE id = ?').run('document-1')
        } else {
          await documents.updateDocumentImportStatus('document-1', 2)
          await documents.updateDocumentById('document-1', {
            ...(change === 'generation changed'
              ? { active_generation_id: 'concurrent-generation' }
              : { content_hash: 'concurrent-hash' }),
            last_error: 'concurrent diagnostic'
          })
        }
        racedDocument = await documents.getDocumentById('document-1')
        fixture.abort.abort()
      })
      try {
        await expect(waitFor(fixture.index(), 'raced cancellation')).rejects.toBeInstanceOf(
          IndexPrepareCancelledError
        )
        expect(write).toHaveBeenCalledTimes(1)
        expect(await documents.getDocumentById('document-1')).toEqual(racedDocument!)
        if (change === 'deleted') expect(racedDocument!).toBeNull()
      } finally {
        write.mockRestore()
        await fixture.prepare.abortActivePrepare()
      }
    }
  )

  it.each(['file', 'web'] as const)(
    'reports a %s cancellation restore failure as an ordinary error',
    async (sourceType) => {
      const fixture = await prepareCancellationFixture(sourceType)
      const failure = new Error('unit restore failed')
      const begin = documents.beginDocumentIndexing.bind(documents)
      const restore = vi.fn(() => {
        throw failure
      })
      const indexing = vi
        .spyOn(documents, 'beginDocumentIndexing')
        .mockImplementation((...args) => {
          const session = begin(...args)
          return { ...session, restore }
        })
      const addChunks = documents.addChunks.bind(documents)
      const write = vi.spyOn(documents, 'addChunks').mockImplementation(async (input) => {
        await addChunks(input)
        fixture.abort.abort()
      })
      try {
        const error = await waitFor(fixture.index(), 'failed cancellation restore').then(
          () => {
            throw new Error('Expected cancellation restore to fail')
          },
          (caught: Error) => caught
        )
        expect(restore).toHaveBeenCalledTimes(1)
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toBeInstanceOf(IndexPrepareCancelledError)
        expect(error).toMatchObject({ name: 'IndexPrepareRestoreError', cause: failure })
        expect(error.message).toContain(failure.message)
        expect(await readActiveChunks('document-1')).toEqual(fixture.previousChunks)
        const table = (await vector.openChunkTable(fixture.prepareIdentity, 768))!
        expect(await table.countRows()).toBe(0)
      } finally {
        indexing.mockRestore()
        write.mockRestore()
        await fixture.prepare.abortActivePrepare()
      }
    }
  )

  it('writes chunks in 128-row batches into a real LanceDB table', async () => {
    const table = await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768, true)
    expect(table).not.toBeNull()
    const add = vi.spyOn(table!, 'add')
    const texts = Array.from({ length: 260 }, (_, index) => 'chunk text ' + index)
    await seed('batch-document', texts)
    expect(add.mock.calls.map(([rows]) => (rows as object[]).length)).toEqual([128, 128, 4])
    expect(await table!.countRows()).toBe(260)
  })

  it('shows only active generations before purging stale and orphan chunks', async () => {
    await seed()
    for (const [documentId, generationId, id] of [
      ['document-1', 'generation-old', 'stale'],
      ['missing-document', 'generation-1', 'orphan']
    ]) {
      await documents.addChunks({
        chunks: [
          {
            id,
            document_id: documentId,
            workspace_id: 'workspace-1',
            source_type: 'file',
            document_name: 'old',
            text: 'quartz stale orphan',
            metadata: { page: 1 }
          }
        ],
        vectors: [localVector],
        generationId
      })
    }
    const expected = ['document-1-chunk-0', 'document-1-chunk-1']
    expect(
      (await documents.listChunks({ workspaceId: 'workspace-1', page: 1, pageSize: 10 })).items
        .map((x) => x.id)
        .sort()
    ).toEqual(expected)
    expect((await documents.ftsSearch('quartz')).map((x) => x.id).sort()).toEqual(expected)
    expect((await documents.vectorSearch(localVector)).map((x) => x.id).sort()).toEqual(expected)
    await documents.purgeStaleChunks()
    expect(await (await vector.openTable('vector_chunk')).countRows()).toBe(2)
  })

  it.each(['file', 'web'] as const)(
    'rebuilds an unchanged %s through the ordinary manual prepare path',
    async (sourceType) => {
      const fixture = await prepareCancellationFixture(sourceType, 2, null)
      const first = await fixture.index()
      const before = await documents.getDocumentById('document-1')
      expect(before?.embedding_identity).toBe(fixture.prepareIdentity)
      // A second model identity uses the same input; content hashes must not skip reindexing.
      const nextIdentity = 'remote:manual-next'
      await embeddings[embeddings.length - 1].configure({
        executor: {
          initialize: async () => undefined,
          embed: async (texts) => ({
            data: Float32Array.from(texts.flatMap(() => [1, 2, 3])),
            dims: [texts.length, 3]
          })
        },
        modelName: 'unit-next',
        identity: nextIdentity,
        kind: 'remote'
      })
      expect(documents.getEmbeddingIndexState(nextIdentity)).toMatchObject({
        staleFileCount: sourceType === 'file' ? 1 : 0,
        staleWebCount: sourceType === 'web' ? 1 : 0,
        completeIdentity: fixture.prepareIdentity
      })
      expect(documents.getStaleEmbeddingDocumentIds(nextIdentity)).toContain('document-1')
      const second = await fixture.index()
      expect(second.contentHash).toBe(first.contentHash)
      expect(await documents.getDocumentById('document-1')).toMatchObject({
        content_hash: before!.content_hash,
        embedding_identity: nextIdentity,
        embedding_dim: 3
      })
      expect(documents.getEmbeddingIndexState(nextIdentity)).toMatchObject({
        staleFileCount: 0,
        staleWebCount: 0
      })
      expect(
        (
          await documents.hybridSearch(
            Float32Array.from([1, 2, 3]),
            'zircon',
            10,
            sourceType,
            undefined,
            undefined,
            nextIdentity
          )
        ).length
      ).toBeGreaterThan(0)
      await fixture.prepare.abortActivePrepare()
    }
  )

  it('holds ordinary indexing across both batches, activation and cleanup before a queued purge', async () => {
    await seed()
    const source = await readActiveChunks('document-1')
    const chunks = source.map((chunk) => ({
      ...chunk,
      id: 'prepare-' + chunk.id,
      generation_id: 'generation-prepare'
    }))
    const table = (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!
    const events: string[] = []
    let signalWritten!: () => void
    let release!: () => void
    const written = new Promise<void>((resolve) => {
      signalWritten = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const operation = documents.runGenerationWrite(async () => {
      await documents.markDocumentIndexing('document-1')
      await documents.addChunks({ chunks: [chunks[0]], vectors: [localVector] })
      events.push('first batch')
      signalWritten()
      await waitFor(barrier, 'ordinary indexing release')
      await documents.addChunks({ chunks: [chunks[1]], vectors: [localVector] })
      events.push('second batch')
      expect(await table.countRows("generation_id = 'generation-1'")).toBe(2)
      await documents.activateDocumentGeneration({
        documentId: 'document-1',
        generationId: 'generation-prepare',
        contentHash: 'hash-2',
        importStatus: 2
      })
      events.push('activated')
      expect(await readActiveChunks('document-1')).toEqual(chunks)
      await documents.deleteChunksByGeneration({
        documentId: 'document-1',
        generationId: 'generation-1'
      })
      events.push('cleaned')
      return 'indexed'
    })
    let purge: Promise<void> | undefined
    try {
      await waitFor(written, 'ordinary indexing first batch')
      purge = documents.purgeStaleChunks().then(() => {
        events.push('purged')
      })
      expect(await table.countRows("generation_id = 'generation-prepare'")).toBe(1)
      expect(await readActiveChunks('document-1')).toEqual(source)
      expect(events).toEqual(['first batch'])
    } finally {
      release()
      await operation
      await purge
    }
    expect(await operation).toBe('indexed')
    expect(events).toEqual(['first batch', 'second batch', 'activated', 'cleaned', 'purged'])
    expect(await table.countRows()).toBe(2)
    expect(await readActiveChunks('document-1')).toEqual(chunks)
    expect(await documents.ftsSearch('quartz')).toHaveLength(2)
  })

  it('defers an ordinary generation writer until an earlier purge has finished', async () => {
    await seed()
    const source = await readActiveChunks('document-1')
    const chunks = source.map((chunk) => ({
      ...chunk,
      id: 'prepare-' + chunk.id,
      generation_id: 'generation-prepare'
    }))
    const table = (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!
    const tablePrototype = Object.getPrototypeOf(table) as typeof table
    const deleteRows = tablePrototype.delete
    let entered!: () => void
    let release!: () => void
    const deleting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let deletions = 0
    vi.spyOn(tablePrototype, 'delete').mockImplementation(async function (
      this: typeof table,
      filter
    ) {
      if (deletions === 0) {
        entered()
        await waitFor(barrier, 'earlier purge release')
      }
      await deleteRows.call(this, filter)
      deletions += 1
    })
    const purge = documents.purgeStaleChunks()
    const write = vi.fn(async () => {
      expect(deletions).toBe(2)
      for (const chunk of chunks) {
        await documents.addChunks({ chunks: [chunk], vectors: [localVector] })
      }
      await documents.activateDocumentGeneration({
        documentId: 'document-1',
        generationId: 'generation-prepare',
        contentHash: 'hash-2'
      })
      await documents.deleteChunksByGeneration({
        documentId: 'document-1',
        generationId: 'generation-1'
      })
    })
    let operation: Promise<void> | undefined
    try {
      await waitFor(deleting, 'earlier purge deletion')
      operation = documents.runGenerationWrite(write)
      expect(await readActiveChunks('document-1')).toEqual(source)
      expect(write).not.toHaveBeenCalled()
    } finally {
      release()
      await purge
      await operation
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(await table.countRows()).toBe(2)
    expect(await readActiveChunks('document-1')).toEqual(chunks)
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

describe('persistent child transcript boundaries', () => {
  it('isolates sessions and rolls back completion and duplicate admission atomically', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-store-'))
    const core = new SqliteCore(path.join(directory, 'app.sqlite'))
    core.initialize()
    try {
      const partners = new PartnerStore(core)
      await partners.savePartner(createPartner('subagent-owner'))
      const logs = new ChatMessageLogStore(core)
      const agents = new AiSubagentStore(core)
      const child = agents.enqueue('subagent-owner', [{ name: '海豹', instruction: '原任务' }])[0]
      const entry = { kind: 'assistant' as const, content: '事实', toolCalls: [] }
      await logs.appendBatch({ partnerId: 'subagent-owner', runId: 'R', entries: [entry] })
      await logs.appendBatch({
        partnerId: 'subagent-owner',
        subagentId: child.agentId,
        runId: 'S1',
        entries: [entry]
      })
      await logs.appendBatch({
        partnerId: 'subagent-owner',
        subagentId: child.agentId,
        runId: 'S2',
        entries: [entry]
      })
      expect((await logs.list('subagent-owner')).map((row) => row.seq)).toEqual([1])
      expect((await logs.list('subagent-owner', child.agentId)).map((row) => row.seq)).toEqual([
        1, 2
      ])
      expect(
        (await logs.listPage({ partnerId: 'subagent-owner', limit: 10 })).records
      ).toHaveLength(1)
      expect(agents.list('another-partner')).toEqual([])
      const update = { ...child, childRunId: 'S2', toolCallId: 'D', status: 'cancelled' as const }
      agents.publish(logs, 'subagent-owner', 'R', update)
      expect(() =>
        agents.enqueue('another-partner', [{ agentId: child.agentId, instruction: '续接' }])
      ).toThrow('不属于')
      expect(() =>
        agents.enqueue('subagent-owner', [
          { agentId: child.agentId, instruction: '续接' },
          { agentId: child.agentId, instruction: '重复' }
        ])
      ).toThrow('正在')
      expect(agents.list('subagent-owner')[0].status).toBe('cancelled')
      core.exec(
        "CREATE TRIGGER reject_child_delete BEFORE DELETE ON ai_subagent BEGIN SELECT RAISE(ABORT, 'delete failed'); END;"
      )
      const before = (await logs.list('subagent-owner')).length
      expect(() =>
        agents.publish(logs, 'subagent-owner', 'R', {
          ...update,
          status: 'completed',
          result: '交付'
        })
      ).toThrow('delete failed')
      expect((await logs.list('subagent-owner')).length).toBe(before)
      expect(await logs.list('subagent-owner', child.agentId)).toHaveLength(2)
      core.exec('DROP TRIGGER reject_child_delete')
      agents.enqueue('subagent-owner', [{ agentId: child.agentId, instruction: '续接' }])
      agents.interruptActive()
      expect(agents.list('subagent-owner')[0]).toMatchObject({
        task: '原任务',
        status: 'interrupted'
      })
      agents.publish(logs, 'subagent-owner', 'R', {
        ...update,
        status: 'completed',
        result: '交付'
      })
      expect(agents.list('subagent-owner')).toEqual([])
      expect(await logs.list('subagent-owner', child.agentId)).toEqual([])
      expect((await logs.list('subagent-owner')).at(-1)?.entry).toMatchObject({
        payload: { result: '交付' }
      })
    } finally {
      core.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
