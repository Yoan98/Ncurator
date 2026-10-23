import { OpenWithPreferenceStore } from '../../../../src/main/services/storage/domains/OpenWithPreferenceStore'
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
import { EmbeddingSettingsStore } from '../../../../src/main/services/storage/domains/EmbeddingSettingsStore'
import {
  EmbeddingModelService,
  remoteEmbeddingIdentity
} from '../../../../src/main/services/vector/EmbeddingModelService'
import { EmbeddingService } from '../../../../src/main/services/vector/EmbeddingService'
import { RemoteEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/RemoteEmbeddingExecutor'
import {
  LOCAL_EMBEDDING_MODEL_ID,
  embeddingInputBudget
} from '../../../../src/shared/embeddingModels'
import { estimateEmbeddingTokens } from '../../../../src/main/services/vector/runtime/embeddingInputBudget'
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
      { version: 21, name: 'embedding_models' }
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
  const remote = {
    id: 'remote-unit',
    name: 'Unit HTTP embedding',
    baseUrl: 'https://embedding.example.invalid/v1',
    apiKey: 'unit-placeholder',
    modelName: 'three-dimensional'
  }
  const identity = remoteEmbeddingIdentity(remote)
  const remoteVector = Float32Array.from([1, 2, 3])
  const localVector = Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
  const models: EmbeddingModelService[] = []
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
    for (const model of models.splice(0)) await model.close()
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
  const replacement = async (documentId = 'document-1') => ({
    documentId,
    generationId: 'generation-1',
    contentHash: 'hash-1',
    embeddingIdentity: identity,
    chunks: await documents.getDocumentEmbeddingChunks(documentId),
    vectors: [remoteVector, remoteVector]
  })
  const changedLayoutReplacement = async () => {
    const input = await replacement()
    const texts = ['quartz first ', 'paragraph', 'quartz second paragraph']
    return {
      ...input,
      targetGenerationId: 'generation-rechunked',
      chunks: texts.map((text, chunk_index) => ({
        ...input.chunks[chunk_index === 2 ? 1 : 0],
        id: 'rechunked-' + chunk_index,
        generation_id: 'generation-rechunked',
        chunk_index,
        text
      })),
      vectors: texts.map(() => remoteVector)
    }
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
  const pauseReplacementAfterWrite = async (embeddingIdentity = identity, dimension = 3) => {
    let signalWritten!: () => void
    let release!: (failure?: Error) => void
    const written = new Promise<void>((resolve) => {
      signalWritten = resolve
    })
    const barrier = new Promise<void>((resolve, reject) => {
      release = (failure) => (failure ? reject(failure) : resolve())
    })
    const table = (await vector.openChunkTable(embeddingIdentity, dimension, true))!
    // 使用实际表创建的 builder，并在真实写入释放表级队列后暂停，允许并发删除继续执行。
    //
    // Use the actual table's builder and pause after its real write releases the table queue so concurrent deletion can proceed.
    const builder = table
      .mergeInsert(['document_id', 'generation_id', 'id'])
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
    const execute = builder.execute.bind(builder)
    let paused = false
    const observedBuilder = new Proxy(builder, {
      get(target, property) {
        if (property === 'whenMatchedUpdateAll' || property === 'whenNotMatchedInsertAll') {
          return () => observedBuilder
        }
        if (property === 'execute')
          return async (...args: Parameters<typeof execute>) => {
            const result = await execute(...args)
            if (!paused) {
              paused = true
              signalWritten()
              await waitFor(barrier, 'replacement write release')
            }
            return result
          }
        return Reflect.get(target, property)
      }
    })
    const openChunkTable = vector.openChunkTable.bind(vector)
    vi.spyOn(vector, 'openChunkTable').mockImplementation(async (...args) => {
      const actual = await openChunkTable(...args)
      if (actual !== table) return actual
      return new Proxy(table, {
        get(target, property) {
          if (property === 'mergeInsert') return () => observedBuilder
          return Reflect.get(target, property)
        }
      })
    })
    return { written: () => waitFor(written, 'replacement batch write'), release }
  }
  const readState = (id = 'document-1') =>
    sqlite
      .prepare(
        'SELECT embedding_identity, embedding_dim, embedding_error, active_generation_id, content_hash FROM document WHERE id = ?'
      )
      .get(id)
  const startModel = async () => {
    const executor = new RemoteEmbeddingExecutor(remote)
    const embeddingService = new EmbeddingService({ executor })
    embeddings.push(embeddingService)
    const model = new EmbeddingModelService({
      settingsStore: new EmbeddingSettingsStore(sqlite),
      documentsStore: documents,
      embeddingService,
      createLocalExecutor: () => {
        throw new Error('This unit test must never access a local model')
      }
    })
    models.push(model)
    await model.initialize()
    return model
  }
  const saveRemoteSettings = () =>
    new EmbeddingSettingsStore(sqlite).save({
      activeModelId: remote.id,
      remoteModels: [remote],
      indexPaused: false
    })
  const mockHttp = () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, request) => {
      const body = JSON.parse(String(request?.body)) as { input: string[] }
      return Response.json({
        data: body.input.map((_, index) => ({ index, embedding: [1, 2, 3] }))
      })
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
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
    const previousChunks = await documents.getDocumentEmbeddingChunks('document-1')
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
        expect
          .soft(await documents.getDocumentEmbeddingChunks('document-1'))
          .toEqual(fixture.previousChunks)
        expect
          .soft((await documents.ftsSearch('quartz')).map((row) => row.text).sort())
          .toEqual(fixture.previousChunks.map((row) => row.text).sort())
        const table = (await vector.openChunkTable(fixture.prepareIdentity, 768))!
        expect.soft(await table.countRows(`generation_id = '${stagedGeneration}'`)).toBe(0)
        expect
          .soft((await documents.listPendingEmbeddingDocuments(identity)).map((doc) => doc.id))
          .toContain('document-1')
        expect.soft(await documents.replaceDocumentEmbeddings(await replacement())).toBe(true)
        expect.soft(readState()).toMatchObject({
          active_generation_id: 'generation-1',
          content_hash: 'hash-1',
          embedding_identity: identity,
          embedding_dim: 3
        })
        expect
          .soft((await documents.getDocumentEmbeddingChunks('document-1')).map((row) => row.text))
          .toEqual(fixture.previousChunks.map((row) => row.text))
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
        const chunks = await documents.getDocumentEmbeddingChunks('document-1')
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
        expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(
          fixture.previousChunks
        )
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

  it('keeps legacy local text searchable while remote identities and dimensions never mix', async () => {
    await seed('legacy')
    await seed('migrated')
    expect(await documents.replaceDocumentEmbeddings(await replacement('migrated'))).toBe(true)
    expect(vector.getChunkTableName(identity, 3)).not.toBe('vector_chunk')
    expect(vector.getChunkTableName(identity, 3)).not.toBe(
      vector.getChunkTableName('remote:other', 3)
    )
    expect(
      (
        await documents.vectorSearch(remoteVector, 50, undefined, undefined, undefined, identity)
      ).map((x) => x.document_id)
    ).toEqual(['migrated', 'migrated'])
    expect(
      await documents.vectorSearch(
        remoteVector,
        50,
        undefined,
        undefined,
        undefined,
        'remote:other'
      )
    ).toEqual([])
    expect((await documents.vectorSearch(localVector)).map((x) => x.document_id)).toEqual([
      'legacy',
      'legacy'
    ])
    expect((await documents.ftsSearch('quartz')).map((x) => x.document_id).sort()).toEqual([
      'legacy',
      'legacy',
      'migrated',
      'migrated'
    ])
    expect(await documents.getEmbeddingCoverage(identity)).toEqual({
      total: 2,
      completed: 1,
      pending: 1,
      failed: 0
    })
  })

  it('commits matching generation and hash once and does not duplicate reads across old and new tables', async () => {
    await seed()
    const input = await replacement()
    expect(await documents.replaceDocumentEmbeddings(input)).toBe(true)
    expect(readState()).toMatchObject({
      embedding_identity: identity,
      embedding_dim: 3,
      active_generation_id: 'generation-1',
      content_hash: 'hash-1',
      embedding_error: null
    })
    expect(await documents.replaceDocumentEmbeddings(input)).toBe(true)
    expect.soft(await documents.countChunksByDocumentIds(['document-1'])).toBe(2)
    expect.soft(await documents.getDocumentEmbeddingChunks('document-1')).toHaveLength(2)
    expect.soft((await documents.listChunks({ page: 1, pageSize: 10 })).items).toHaveLength(2)
    expect.soft(await documents.ftsSearch('quartz')).toHaveLength(2)
    expect.soft(await (await vector.openChunkTable(identity, 3))!.countRows()).toBe(2)
  })

  it.each(['different identity', 'same identity'] as const)(
    'atomically activates all three replacement chunks with %s and reclaims only the old generation',
    async (model) => {
      await seed()
      const input = await changedLayoutReplacement()
      if (model === 'same identity') {
        input.embeddingIdentity = LOCAL_EMBEDDING_MODEL_ID
        input.vectors = input.chunks.map(() => localVector)
      }
      const source = await documents.getDocumentEmbeddingChunks('document-1')
      await documents.addChunks({
        chunks: source.map((chunk) => ({
          ...chunk,
          id: 'prepare-' + chunk.id,
          generation_id: 'generation-prepare'
        })),
        vectors: source.map(() => localVector),
        generationId: 'generation-prepare'
      })
      const pause = await pauseReplacementAfterWrite(
        input.embeddingIdentity,
        input.vectors[0].length
      )
      const operation = documents.replaceDocumentEmbeddings(input)
      try {
        await pause.written()
        expect(readState()).toMatchObject({
          active_generation_id: 'generation-1',
          embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
          embedding_dim: 768
        })
        expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(source)
        expect((await documents.ftsSearch('quartz')).map((row) => row.id).sort()).toEqual(
          source.map((chunk) => chunk.id).sort()
        )
      } finally {
        pause.release()
        await operation
      }
      expect(await operation).toBe(true)
      expect(readState()).toMatchObject({
        active_generation_id: input.targetGenerationId,
        embedding_identity: input.embeddingIdentity,
        embedding_dim: input.vectors[0].length,
        content_hash: 'hash-1',
        embedding_error: null
      })
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(input.chunks)
      expect(input.chunks.map((chunk) => chunk.text).join('')).toBe(
        source.map((chunk) => chunk.text).join('')
      )
      const listed = await documents.listChunks({ page: 1, pageSize: 10 })
      expect(listed.total).toBe(3)
      expect(listed.items.map((chunk) => chunk.id).sort()).toEqual(
        input.chunks.map((chunk) => chunk.id).sort()
      )
      expect(await documents.countChunksByDocumentIds(['document-1'])).toBe(3)
      expect((await documents.ftsSearch('quartz paragraph')).map((row) => row.id).sort()).toEqual([
        'rechunked-0',
        'rechunked-1',
        'rechunked-2'
      ])
      const localTable = (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!
      expect(await localTable.countRows("generation_id = 'generation-1'")).toBe(0)
      expect(await localTable.countRows("generation_id = 'generation-prepare'")).toBe(2)
      expect(
        await documents.vectorSearch(
          input.vectors[0],
          50,
          undefined,
          undefined,
          undefined,
          input.embeddingIdentity
        )
      ).toHaveLength(3)
      expect(await documents.replaceDocumentEmbeddings(input)).toBe(false)
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(input.chunks)
    }
  )

  it.each([
    'hash changed',
    'generation changed',
    'cancelled',
    'deleted',
    'indexing',
    'write failed'
  ] as const)(
    'cleans the newly written generation when %s invalidates replacement without losing ordinary prepare chunks',
    async (change) => {
      await seed()
      const source = await documents.getDocumentEmbeddingChunks('document-1')
      const input = await changedLayoutReplacement()
      let current = true
      const pause = await pauseReplacementAfterWrite()
      const operation = documents.replaceDocumentEmbeddings({ ...input, isCurrent: () => current })
      try {
        await pause.written()
        const target = (await vector.openChunkTable(identity, 3))!
        expect(await target.countRows()).toBe(3)
        expect((await documents.ftsSearch('paragraph')).map((row) => row.id).sort()).toEqual(
          source.map((chunk) => chunk.id).sort()
        )
        await documents.addChunks({
          chunks: source.map((chunk) => ({
            ...chunk,
            id: 'prepare-' + chunk.id,
            generation_id: 'generation-prepare'
          })),
          vectors: source.map(() => localVector),
          generationId: 'generation-prepare'
        })
        if (change === 'hash changed')
          await documents.updateDocumentById('document-1', { content_hash: 'hash-2' })
        else if (change === 'generation changed')
          await documents.activateDocumentGeneration({
            documentId: 'document-1',
            generationId: 'generation-prepare',
            contentHash: 'hash-2'
          })
        else if (change === 'cancelled') current = false
        else if (change === 'deleted') {
          expect((await documents.deleteDocumentsByIds(['document-1'])).success).toBe(true)
        } else if (change === 'indexing') await documents.markDocumentIndexing('document-1')
        if (change === 'write failed') {
          pause.release(new Error('unit failure after target write'))
          await expect(operation).rejects.toThrow('unit failure after target write')
        } else {
          pause.release()
          expect(await operation).toBe(false)
        }
      } finally {
        pause.release()
        await operation.catch(() => undefined)
      }
      expect(await (await vector.openChunkTable(identity, 3))!.countRows()).toBe(0)
      if (change === 'deleted') {
        expect(readState()).toBeUndefined()
        expect(await documents.ftsSearch('paragraph')).toEqual([])
      } else {
        expect(readState()).toMatchObject({
          embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
          embedding_dim: 768,
          active_generation_id:
            change === 'generation changed' ? 'generation-prepare' : 'generation-1'
        })
        const localTable = (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!
        expect(await localTable.countRows("generation_id = 'generation-1'")).toBe(2)
        expect(await localTable.countRows("generation_id = 'generation-prepare'")).toBe(2)
        expect(
          (await documents.getDocumentEmbeddingChunks('document-1')).map((chunk) => chunk.text)
        ).toEqual(source.map((chunk) => chunk.text))
        expect(await documents.ftsSearch('paragraph')).toHaveLength(2)
      }
    }
  )

  it('does not purge a partly written replacement generation between batches', async () => {
    await seed()
    const input = await changedLayoutReplacement()
    input.chunks = Array.from({ length: 130 }, (_, chunk_index) => ({
      ...input.chunks[0],
      id: 'batched-' + chunk_index,
      chunk_index,
      text: 'quartz replacement ' + chunk_index
    }))
    input.vectors = input.chunks.map(() => remoteVector)
    const pause = await pauseReplacementAfterWrite()
    const operation = documents.replaceDocumentEmbeddings(input)
    let purged = false
    let purge: Promise<void> | undefined
    try {
      await pause.written()
      expect(await (await vector.openChunkTable(identity, 3))!.countRows()).toBe(128)
      purge = documents.purgeStaleChunks().then(() => {
        purged = true
      })
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toHaveLength(2)
      expect(purged).toBe(false)
    } finally {
      pause.release()
      await operation
      await purge
    }
    expect(await operation).toBe(true)
    expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(input.chunks)
    expect(await documents.ftsSearch('quartz', 200)).toHaveLength(130)
    expect(await (await vector.openChunkTable(identity, 3))!.countRows()).toBe(130)
  })

  it('waits for a purge snapshot taken before replacement starts before writing its new generation', async () => {
    await seed()
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
    vi.spyOn(tablePrototype, 'delete').mockImplementationOnce(async function (
      this: typeof table,
      filter
    ) {
      entered()
      await waitFor(barrier, 'purge release')
      await deleteRows.call(this, filter)
    })
    const input = await changedLayoutReplacement()
    const purge = documents.purgeStaleChunks()
    let operation: Promise<boolean> | undefined
    try {
      await waitFor(deleting, 'purge deletion')
      operation = documents.replaceDocumentEmbeddings(input)
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toHaveLength(2)
      expect(await vector.openChunkTable(identity, 3)).toBeNull()
    } finally {
      release()
      await purge
      await operation
    }
    expect(await operation).toBe(true)
    expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(input.chunks)
    expect(await documents.countChunksByDocumentIds(['document-1'])).toBe(3)
  })

  it('holds ordinary indexing across both batches, activation and cleanup before a queued purge', async () => {
    await seed()
    const source = await documents.getDocumentEmbeddingChunks('document-1')
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
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(chunks)
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
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(source)
      expect(events).toEqual(['first batch'])
    } finally {
      release()
      await operation
      await purge
    }
    expect(await operation).toBe('indexed')
    expect(events).toEqual(['first batch', 'second batch', 'activated', 'cleaned', 'purged'])
    expect(await table.countRows()).toBe(2)
    expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(chunks)
    expect(await documents.ftsSearch('quartz')).toHaveLength(2)
  })

  it('defers an ordinary generation writer until an earlier purge has finished', async () => {
    await seed()
    const source = await documents.getDocumentEmbeddingChunks('document-1')
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
      expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(source)
      expect(write).not.toHaveBeenCalled()
    } finally {
      release()
      await purge
      await operation
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(await table.countRows()).toBe(2)
    expect(await documents.getDocumentEmbeddingChunks('document-1')).toEqual(chunks)
  })

  it('validates target chunk ownership and preserves nonempty documents when given zero chunks', async () => {
    await seed()
    const input = await changedLayoutReplacement()
    await expect(
      documents.replaceDocumentEmbeddings({
        ...input,
        chunks: input.chunks.map((chunk) => ({ ...chunk, generation_id: input.generationId }))
      })
    ).rejects.toThrow('chunks must match the document generation')
    await expect(
      documents.replaceDocumentEmbeddings({ ...input, chunks: [], vectors: [] })
    ).rejects.toThrow('Cannot replace a nonempty document with empty embeddings')
    expect(readState()).toMatchObject({ active_generation_id: 'generation-1', embedding_dim: 768 })
    expect(await documents.getDocumentEmbeddingChunks('document-1')).toHaveLength(2)
  })

  it('persists embedding errors across reopen and clears only pending errors for the selected identity', async () => {
    await seed()
    await documents.markDocumentEmbeddingError(
      'document-1',
      'generation-1',
      'HTTP 401 unit failure'
    )
    sqlite.close()
    sqlite.initialize()
    documents = new DocumentsStore(sqlite, vector)
    expect(readState()).toMatchObject({ embedding_error: 'HTTP 401 unit failure' })
    expect(await documents.getEmbeddingCoverage(identity)).toEqual({
      total: 1,
      completed: 0,
      pending: 0,
      failed: 1
    })
    expect(await documents.listPendingEmbeddingDocuments(identity)).toEqual([])
    await documents.clearEmbeddingErrors(identity)
    expect(readState()).toMatchObject({ embedding_error: null })
    expect(await documents.listPendingEmbeddingDocuments(identity)).toHaveLength(1)
    await documents.markDocumentEmbeddingError('document-1', 'obsolete-generation', 'stale error')
    expect(readState()).toMatchObject({ embedding_error: null })
  })

  it.each(['deleted', 'generation changed', 'hash changed', 'indexing'] as const)(
    'rejects a captured embedding when its document is %s before commit',
    async (change) => {
      await seed()
      const input = await replacement()
      if (change === 'deleted') await documents.deleteDocumentsByIds(['document-1'])
      else if (change === 'generation changed')
        await documents.updateDocumentById('document-1', { active_generation_id: 'generation-2' })
      else if (change === 'hash changed')
        await documents.updateDocumentById('document-1', { content_hash: 'hash-2' })
      else await documents.markDocumentIndexing('document-1')
      expect(await documents.replaceDocumentEmbeddings(input)).toBe(false)
      const table = await vector.openChunkTable(identity, 3)
      expect(table ? await table.countRows() : 0).toBe(0)
      if (change !== 'deleted')
        expect(readState()).toMatchObject({ embedding_identity: LOCAL_EMBEDDING_MODEL_ID })
      expect(await documents.getEmbeddingCoverage(identity)).toMatchObject({ completed: 0 })
    }
  )

  it('rejects cancellation after asynchronous vector writes and retains the prior readable chunks', async () => {
    await seed()
    let checks = 0
    expect(
      await documents.replaceDocumentEmbeddings({
        ...(await replacement()),
        isCurrent: () => ++checks === 1
      })
    ).toBe(false)
    expect(checks).toBeGreaterThan(1)
    expect(readState()).toMatchObject({ embedding_identity: LOCAL_EMBEDDING_MODEL_ID })
    expect(await documents.ftsSearch('quartz')).toHaveLength(2)
    const table = await vector.openChunkTable(identity, 3)
    expect(table ? await table.countRows() : 0).toBe(0)
  })

  it.each(['deleted', 'generation changed', 'hash changed'] as const)(
    'rejects CAS when the document is %s while HTTP embedding is in flight',
    async (change) => {
      await seed()
      let release!: (response: Response) => void
      let started!: () => void
      const requested = new Promise<void>((resolve) => {
        started = resolve
      })
      const response = new Promise<Response>((resolve) => {
        release = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () => {
          started()
          return response
        })
      )
      saveRemoteSettings()
      const model = await startModel()
      try {
        await waitFor(requested, 'HTTP embedding request')
        await model.control('pause')
        if (change === 'deleted') await documents.deleteDocumentsByIds(['document-1'])
        else if (change === 'generation changed')
          await documents.updateDocumentById('document-1', { active_generation_id: 'generation-2' })
        else await documents.updateDocumentById('document-1', { content_hash: 'hash-2' })
      } finally {
        release(Response.json({ data: [0, 1].map((index) => ({ index, embedding: [1, 2, 3] })) }))
      }
      await model.close()
      expect(await documents.getEmbeddingCoverage(identity)).toMatchObject({ completed: 0 })
      const table = await vector.openChunkTable(identity, 3)
      expect(table ? await table.countRows() : 0).toBe(0)
      if (change === 'deleted') expect(await documents.getDocumentById('document-1')).toBeNull()
      else expect(readState()).toMatchObject({ embedding_identity: LOCAL_EMBEDDING_MODEL_ID })
    }
  )

  it('re-embeds saved chunks with production services and mocked HTTP even when the source path is missing', async () => {
    await seed()
    await expect(
      fs.access(path.join(tempDir, 'missing-source', 'document-1.txt'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const fetch = mockHttp()
    saveRemoteSettings()
    const model = await startModel()
    await expect
      .poll(async () => (await model.getSnapshot()).index.completed, { timeout: 5000 })
      .toBe(1)
    const sent = fetch.mock.calls.flatMap(
      ([, request]) => (JSON.parse(String(request?.body)) as { input: string[] }).input
    )
    expect(sent).toEqual(['quartz first paragraph', 'quartz second paragraph'])
    expect(readState()).toMatchObject({ embedding_identity: identity, embedding_dim: 3 })
    expect(
      await documents.vectorSearch(remoteVector, 50, undefined, undefined, undefined, identity)
    ).toHaveLength(2)
  })

  it('re-splits saved long chunks within a 512-token budget and migrates every slice without source files', async () => {
    const texts = [
      'zircon searchable marker',
      'quartz 第一段😀 '.repeat(90) + '\r\n第一段结束。',
      'quartz second paragraph e\u0301 '.repeat(80) + '\nsecond paragraph end.'
    ]
    await seed('document-1', texts)
    // 独立短块证明迁移期间 FTS 持续可用；长正文完整性由读回、拼接和真实表行数验证。
    //
    // A separate short chunk proves FTS stays available during migration; reads, concatenation and real table counts verify the long text.
    const keyword = 'zircon'
    const beforeSearch = (await documents.ftsSearch(keyword)).map(({ id, text }) => ({ id, text }))
    expect(beforeSearch.length).toBeGreaterThan(0)
    await expect(
      fs.access(path.join(tempDir, 'missing-source', 'document-1.txt'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const limitedRemote = { ...remote, maxInputTokens: 512 }
    const limitedIdentity = remoteEmbeddingIdentity(limitedRemote)
    const budget = embeddingInputBudget(limitedRemote.maxInputTokens).contentTokenBudget
    expect(texts.slice(1).every((text) => estimateEmbeddingTokens(text) > budget)).toBe(true)
    let requested!: () => void
    let release!: () => void
    const firstRequest = new Promise<void>((resolve) => {
      requested = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (_url, request) => {
        const body = JSON.parse(String(request?.body)) as { input: string[] }
        for (const text of body.input) {
          expect(estimateEmbeddingTokens(text)).toBeLessThanOrEqual(budget)
        }
        sent.push(...body.input)
        requested()
        await waitFor(barrier, 'rechunk HTTP response release')
        return Response.json({
          data: body.input.map((_, index) => ({ index, embedding: [1, 2, 3] }))
        })
      })
    )
    new EmbeddingSettingsStore(sqlite).save({
      activeModelId: limitedRemote.id,
      remoteModels: [limitedRemote],
      indexPaused: false
    })
    const model = await startModel()
    try {
      await waitFor(firstRequest, 'rechunk HTTP request')
      expect(readState()).toMatchObject({
        active_generation_id: 'generation-1',
        embedding_identity: LOCAL_EMBEDDING_MODEL_ID
      })
      expect(
        (await documents.getDocumentEmbeddingChunks('document-1')).map((chunk) => chunk.text)
      ).toEqual(texts)
      expect((await documents.ftsSearch(keyword)).map(({ id, text }) => ({ id, text }))).toEqual(
        beforeSearch
      )
    } finally {
      release()
    }
    await expect
      .poll(async () => (await model.getSnapshot()).index, { timeout: 5000 })
      .toMatchObject({ total: 1, completed: 1, pending: 0, failed: 0, status: 'idle' })
    const migrated = await documents.getDocumentEmbeddingChunks('document-1')
    expect(migrated.length).toBeGreaterThan(texts.length)
    expect(migrated.map((chunk) => chunk.text)).toEqual(sent)
    expect(migrated.map((chunk) => chunk.text).join('')).toBe(texts.join(''))
    expect(migrated.every((chunk) => estimateEmbeddingTokens(chunk.text) <= budget)).toBe(true)
    expect(migrated.map((chunk) => chunk.chunk_index)).toEqual(migrated.map((_, index) => index))
    expect(new Set(migrated.map((chunk) => chunk.id)).size).toBe(migrated.length)
    expect(
      migrated.every(
        (chunk) => !texts.map((_, index) => 'document-1-chunk-' + index).includes(chunk.id)
      )
    ).toBe(true)
    expect(migrated[0].generation_id).not.toBe('generation-1')
    expect(migrated.every((chunk) => chunk.generation_id === migrated[0].generation_id)).toBe(true)
    expect(readState()).toMatchObject({
      active_generation_id: migrated[0].generation_id,
      content_hash: 'hash-1',
      embedding_identity: limitedIdentity,
      embedding_dim: 3
    })
    expect(await (await vector.openChunkTable(limitedIdentity, 3))!.countRows()).toBe(
      migrated.length
    )
    expect(await (await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768))!.countRows()).toBe(0)
    const afterSearch = await documents.ftsSearch(keyword)
    expect(afterSearch.length).toBeGreaterThan(0)
    expect(afterSearch.every((row) => migrated.some((chunk) => chunk.id === row.id))).toBe(true)
  })

  it('resumes only unfinished documents after reopening both databases', async () => {
    await seed('done')
    await seed('pending')
    expect(await documents.replaceDocumentEmbeddings(await replacement('done'))).toBe(true)
    saveRemoteSettings()
    await vector.close()
    sqlite.close()
    sqlite = new SqliteCore(path.join(tempDir, 'app.sqlite'))
    sqlite.initialize()
    vector = new LanceDbCore(path.join(tempDir, 'lancedb'))
    await vector.initialize()
    documents = new DocumentsStore(sqlite, vector)
    expect((await documents.listPendingEmbeddingDocuments(identity)).map((x) => x.id)).toEqual([
      'pending'
    ])
    const fetch = mockHttp()
    const model = await startModel()
    await expect
      .poll(async () => (await model.getSnapshot()).index, { timeout: 5000 })
      .toMatchObject({ completed: 2, pending: 0, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await documents.countChunksByDocumentIds(['done', 'pending'])).toBe(4)
  })

  it.each(['HTTP 401', 'invalid vector dimension'] as const)(
    'records %s without claiming completion or losing old text',
    async (failure) => {
      await seed()
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () =>
          failure === 'HTTP 401'
            ? new Response('unit unauthorized', { status: 401 })
            : Response.json({
                data: [
                  { index: 0, embedding: [1, 2, 3] },
                  { index: 1, embedding: [1, 2] }
                ]
              })
        )
      )
      saveRemoteSettings()
      const model = await startModel()
      await expect
        .poll(async () => (await model.getSnapshot()).index, { timeout: 5000 })
        .toMatchObject({ completed: 0, failed: 1 })
      expect((await model.getSnapshot()).index).toMatchObject({ completed: 0, failed: 1 })
      expect(readState()).toMatchObject({
        embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
        embedding_error: expect.any(String)
      })
      expect(await documents.ftsSearch('quartz')).toHaveLength(2)
      expect(
        await documents.vectorSearch(remoteVector, 50, undefined, undefined, undefined, identity)
      ).toEqual([])
    }
  )

  it('clears a failed remote migration when selecting the still-valid local model', async () => {
    await seed()
    const local: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async (texts) => ({
        data: Float32Array.from(texts.flatMap(() => Array.from(localVector))),
        dims: [texts.length, localVector.length]
      })),
      close: vi.fn(async () => undefined)
    }
    const embeddingService = new EmbeddingService({ executor: local })
    embeddings.push(embeddingService)
    new EmbeddingSettingsStore(sqlite).save({
      activeModelId: LOCAL_EMBEDDING_MODEL_ID,
      remoteModels: [remote],
      indexPaused: false
    })
    const model = new EmbeddingModelService({
      settingsStore: new EmbeddingSettingsStore(sqlite),
      documentsStore: documents,
      embeddingService,
      createLocalExecutor: () => local
    })
    models.push(model)
    await model.initialize()
    expect((await model.getSnapshot()).index).toMatchObject({
      total: 1,
      completed: 1,
      failed: 0
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => new Response('unit unauthorized', { status: 401 }))
    )
    await model.select(remote.id)
    await expect.poll(async () => (await model.getSnapshot()).index.failed).toBe(1)
    expect(readState()).toMatchObject({
      embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
      embedding_dim: 768,
      embedding_error: expect.stringContaining('401')
    })
    await model.select(LOCAL_EMBEDDING_MODEL_ID)
    await expect
      .poll(
        async () => ({
          snapshot: await model.getSnapshot(),
          document: readState()
        }),
        { timeout: 3000 }
      )
      .toMatchObject({
        snapshot: {
          activeModelId: LOCAL_EMBEDDING_MODEL_ID,
          index: { total: 1, completed: 1, pending: 0, failed: 0 }
        },
        document: {
          embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
          embedding_dim: 768,
          embedding_error: null
        }
      })
    expect(await documents.vectorSearch(localVector, 50, 'file', 'workspace-1')).toHaveLength(2)
    expect(local.embed).not.toHaveBeenCalled()
  })

  it('aborts a hanging HTTP request and finishes close in less than one second', async () => {
    await seed()
    let started!: () => void
    const requested = new Promise<void>((resolve) => {
      started = resolve
    })
    let signal: AbortSignal | null | undefined
    let aborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (_url, request) => {
        signal = request?.signal
        return new Promise<Response>((_resolve, reject) => {
          // 超时只负责失败后的资源收敛；成功取消必须来自生产执行器的 AbortSignal。
          //
          // The timeout only bounds failure cleanup; successful cancellation must come from the production executor's AbortSignal.
          const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            reject(new Error('unit HTTP watchdog: request was not aborted'))
          }, 2000)
          const onAbort = () => {
            aborted = true
            clearTimeout(timeout)
            reject(new DOMException('Request aborted', 'AbortError'))
          }
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort, { once: true })
          started()
        })
      })
    )
    saveRemoteSettings()
    const model = await startModel()
    await waitFor(requested, 'abortable HTTP request')
    expect(signal).toBeInstanceOf(AbortSignal)
    const startedAt = performance.now()
    await model.close()
    expect.soft(performance.now() - startedAt).toBeLessThan(1000)
    expect.soft(aborted).toBe(true)
    expect.soft(signal?.aborted).toBe(true)
    expect(readState()).toMatchObject({
      embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
      embedding_dim: 768,
      embedding_error: null
    })
    expect(await documents.ftsSearch('quartz')).toHaveLength(2)
    expect(
      await documents.vectorSearch(remoteVector, 50, undefined, undefined, undefined, identity)
    ).toEqual([])
  })

  it('keeps unchanged FTS text unique while a remote-to-local marker switches during a query', async () => {
    await seed()
    expect(await documents.replaceDocumentEmbeddings(await replacement())).toBe(true)
    const local: EmbeddingExecutor = {
      initialize: async () => undefined,
      embed: async (texts) => ({
        data: Float32Array.from(texts.flatMap(() => Array.from(localVector))),
        dims: [texts.length, localVector.length]
      })
    }
    const embeddingService = new EmbeddingService({ executor: new RemoteEmbeddingExecutor(remote) })
    embeddings.push(embeddingService)
    saveRemoteSettings()
    const model = new EmbeddingModelService({
      settingsStore: new EmbeddingSettingsStore(sqlite),
      documentsStore: documents,
      embeddingService,
      createLocalExecutor: () => local
    })
    models.push(model)
    await model.initialize()
    const before = await documents.ftsSearch('quartz', 50, 'file', 'workspace-1')
    expect(before).toHaveLength(2)
    await model.control('pause')
    const localReplacement = {
      ...(await replacement()),
      embeddingIdentity: LOCAL_EMBEDDING_MODEL_ID,
      vectors: [localVector, localVector]
    }
    const table = await vector.openChunkTable(LOCAL_EMBEDDING_MODEL_ID, 768)
    expect(table).not.toBeNull()
    const countRows = table!.countRows.bind(table!)
    let entered = false
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const count = vi.spyOn(table!, 'countRows').mockImplementationOnce(async (filter) => {
      const result = await countRows(filter)
      entered = true
      await waitFor(barrier, 'FTS query release')
      return result
    })
    const query = documents.ftsSearch('quartz', 50, 'file', 'workspace-1')
    try {
      await expect.poll(() => entered, { timeout: 2000 }).toBe(true)
      count.mockRestore()
      await model.select(LOCAL_EMBEDDING_MODEL_ID)
      expect(await documents.replaceDocumentEmbeddings(localReplacement)).toBe(true)
      expect((await model.getSnapshot()).index).toMatchObject({ completed: 1, failed: 0 })
      expect(readState()).toMatchObject({
        embedding_identity: LOCAL_EMBEDDING_MODEL_ID,
        embedding_dim: 768
      })
    } finally {
      release()
      await query
    }
    const during = await query
    expect(
      during.map(({ id, text }) => ({ id, text })).sort((a, b) => a.id.localeCompare(b.id))
    ).toEqual(before.map(({ id, text }) => ({ id, text })).sort((a, b) => a.id.localeCompare(b.id)))
    expect(new Set(during.map((chunk) => chunk.id)).size).toBe(2)
    expect(await documents.ftsSearch('quartz', 50, 'web', 'workspace-1')).toEqual([])
  })

  it('continues migration after a queued document is normally updated to the current remote generation', async () => {
    for (const id of ['first', 'updated', 'remaining']) await seed(id)
    const queued = await documents.listPendingEmbeddingDocuments(identity)
    expect(queued).toHaveLength(3)
    const [first, updated, remaining] = queued
    let started!: () => void
    let release!: () => void
    const requested = new Promise<void>((resolve) => {
      started = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let requests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (_url, request) => {
        const body = JSON.parse(String(request?.body)) as { input: string[] }
        if (++requests === 1) {
          started()
          await waitFor(barrier, 'migration HTTP response release')
        }
        return Response.json({
          data: body.input.map((_, index) => ({ index, embedding: [1, 2, 3] }))
        })
      })
    )
    saveRemoteSettings()
    const model = await startModel()
    const updatedTexts = [
      'quartz updated generation two first',
      'quartz updated generation two second'
    ]
    try {
      await waitFor(requested, 'migration HTTP request')
      expect(readState(first.id)).toMatchObject({ embedding_identity: LOCAL_EMBEDDING_MODEL_ID })
      await documents.markDocumentIndexing(updated.id)
      await documents.addChunks({
        chunks: updatedTexts.map((text, chunk_index) => ({
          id: updated.id + '-generation-2-' + chunk_index,
          document_id: updated.id,
          workspace_id: 'workspace-1',
          source_type: 'file',
          document_name: updated.id,
          text,
          metadata: { page: 1 },
          chunk_index
        })),
        vectors: updatedTexts.map(() => remoteVector),
        generationId: 'generation-2',
        embeddingIdentity: identity
      })
      await documents.activateDocumentGeneration({
        documentId: updated.id,
        generationId: 'generation-2',
        contentHash: 'hash-2',
        importStatus: 2,
        embeddingIdentity: identity,
        dimension: 3
      })
      await documents.deleteChunksByGeneration({
        documentId: updated.id,
        generationId: 'generation-1'
      })
    } finally {
      release()
    }
    await expect
      .poll(async () => (await model.getSnapshot()).index, { timeout: 5000 })
      .toMatchObject({ total: 3, completed: 3, pending: 0, failed: 0, status: 'idle' })
    expect(readState(updated.id)).toMatchObject({
      embedding_identity: identity,
      embedding_dim: 3,
      embedding_error: null,
      active_generation_id: 'generation-2',
      content_hash: 'hash-2'
    })
    expect(readState(remaining.id)).toMatchObject({
      embedding_identity: identity,
      embedding_dim: 3,
      embedding_error: null
    })
    expect(
      (await documents.getDocumentEmbeddingChunks(updated.id)).map((chunk) => chunk.text)
    ).toEqual(updatedTexts)
    expect(await documents.ftsSearch('quartz', 50, 'file', 'workspace-1')).toHaveLength(6)
    expect(
      await documents.vectorSearch(remoteVector, 50, 'file', 'workspace-1', undefined, identity)
    ).toHaveLength(6)
  })

  it('completes a legitimate empty document with dimension zero without requesting HTTP embeddings', async () => {
    await seed('empty', [])
    const fetch = mockHttp()
    saveRemoteSettings()
    const model = await startModel()
    await expect
      .poll(
        async () => ({ index: (await model.getSnapshot()).index, document: readState('empty') }),
        { timeout: 5000 }
      )
      .toMatchObject({
        index: { total: 1, completed: 1, pending: 0, failed: 0 },
        document: { embedding_identity: identity, embedding_dim: 0, embedding_error: null }
      })
    expect(fetch).not.toHaveBeenCalled()
    expect(await documents.getDocumentEmbeddingChunks('empty')).toEqual([])
    expect(
      await documents.vectorSearch(remoteVector, 50, undefined, undefined, undefined, identity)
    ).toEqual([])
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
