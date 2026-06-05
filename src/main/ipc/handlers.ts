import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IngestionService } from '../services/ingestion/loader'
import { EmbeddingService } from '../services/vector/EmbeddingService'
import { ensureEmbeddingReady } from '../services/vector/ensureEmbeddingReady'
import { StorageService } from '../services/storage/StorageService'
import { ModelService } from '../services/model/ModelService'
import { fetchLlmRemoteModels } from '../services/llm/modelCatalog'
import { AiRunService } from '../services/ai/AiRunService'
import { emitThinkingStarted } from '../services/ai/events/processEvents'
import { updateConversationMemoryAfterRun } from '../services/ai/memory'
import { getAiContextUsage } from '../services/ai/contextUsage'
import { DocxApplyService } from '../services/ai/human/tools/docx/review/DocxApplyService'
import { releaseDocxRunSession } from '../services/ai/human/tools/docx/worker/docxWorkerClient'
import type { AiLlmIoRecord } from '../../shared/types'
import {
  buildWebReferenceItem,
  buildWorkspaceReferenceItems,
  referenceMatchesQuery,
  shouldIncludeReferenceInSearch
} from '../services/sourceScope/selection'
import { validateSelectedReferencesForRun } from '../services/sourceScope/validation'
import { WorkspaceSourceService } from '../services/workspace/WorkspaceSourceService'
import { WorkspaceKnowledgePrepareService } from '../services/workspace/WorkspaceKnowledgePrepareService'
import { WebSourceService } from '../services/web/WebSourceService'
import { v4 as uuidv4 } from 'uuid'
import type {
  SearchResult,
  DocumentListResponse,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  AiRuntimeSettings,
  LLMConfig,
  LlmModelListResponse,
  AiRunEvent,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse,
  RevertDocxApplyRequest,
  RevertDocxApplyResponse,
  CreateWorkspaceSourceRequest,
  DeleteWorkspaceSourceResponse,
  ListReferenceItemsRequest,
  ListWorkspaceTreeRequest,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
  PrepareWebSourcesRequest,
  PickDirectoryResponse,
  PickApplicationResponse,
  ReferenceItemListResponse,
  ScanWebSourcesRequest,
  SetWorkspaceRootPathRequest,
  ListWebSourcesRequest,
  RefreshWebSourceRequest,
  DeleteWebSourceRequest,
  SelectedReference,
  WebSourceListResponse,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  WebSourceRecord,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobGetRequest,
  WorkspaceIndexJobResponse,
  WorkspaceIndexJobSourceKind,
  WorkspaceFileIndexRecord,
  WorkspaceJobResponse,
  WorkspaceMutationResponse,
  WorkspaceListItem,
  WorkspaceTreeListResponse,
  WorkspaceSource,
  WorkspaceListResponse
} from '../types/store'
import path from 'path'
import fs from 'fs'
import { WEB_INGEST_CONCURRENCY } from '../utils/constant'
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { normalizeForIpc } from '../utils/serialization'
import {
  createE2EFixtureWorkspace,
  deleteE2EFixtureWebSource,
  deleteE2EFixtureWorkspace,
  getE2EFixtureSearchResponse,
  getE2EFixtureWebSourceList,
  getE2EFixtureWorkspaceList,
  getE2EFixtureWorkspaceDelayMs,
  getE2EFixtureReferenceItems,
  ingestE2EFixtureWebSource,
  ingestE2EFixtureWebSources,
  isE2EFixtureModeEnabled,
  matchE2EChatScenario,
  prepareE2EFixtureWebSources,
  prepareE2EFixtureWorkspace,
  refreshE2EFixtureWebSource,
  scanE2EFixtureWebSources,
  scanE2EFixtureWorkspace,
  getE2EFixtureWorkspaceTree,
  setE2EFixtureWorkspaceRootPath
} from '../testing/e2eFixtures'

const jieba = Jieba.withDict(dict)
const execFileAsync = promisify(execFile)
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toTrimmedStringList = (values: string[] | undefined): string[] =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []

const normalizeKbAvailability = (value: string | undefined): SelectedReference['kbAvailability'] =>
  value === 'indexed' || value === 'partial' || value === 'not_indexed' ? value : 'not_indexed'

const normalizeSelectedReferences = (
  references: AiRunStartRequest['selectedReferences']
): SelectedReference[] | undefined => {
  if (!Array.isArray(references)) return undefined

  const normalized = references
    .map((reference) => {
      if (reference.kind === 'web') {
        return {
          kind: 'web' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          webSourceId: String(reference.webSourceId || '').trim(),
          name: String(reference.name || '').trim(),
          url: String(reference.url || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability)
        }
      }

      if (reference.kind === 'directory') {
        return {
          kind: 'directory' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          nodeId: String(reference.nodeId || '').trim(),
          name: String(reference.name || '').trim(),
          relativePath: String(reference.relativePath || '').trim(),
          absolutePath: String(reference.absolutePath || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability),
          indexedFileCount: Math.max(0, Number(reference.indexedFileCount || 0)),
          notIndexedFileCount: Math.max(0, Number(reference.notIndexedFileCount || 0))
        }
      }

      return {
        kind: 'file' as const,
        workspaceId: String(reference.workspaceId || '').trim(),
        nodeId: String(reference.nodeId || '').trim(),
        name: String(reference.name || '').trim(),
        relativePath: String(reference.relativePath || '').trim(),
        absolutePath: String(reference.absolutePath || '').trim(),
        fileExt: reference.fileExt ? String(reference.fileExt).trim() : undefined,
        kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
        kbAvailability: normalizeKbAvailability(reference.kbAvailability)
      }
    })
    .filter((reference) => {
      if (reference.kind === 'web') {
        return Boolean(
          reference.workspaceId && reference.webSourceId && reference.name && reference.url
        )
      }

      return Boolean(
        reference.workspaceId &&
        reference.nodeId &&
        reference.name &&
        reference.relativePath &&
        reference.absolutePath
      )
    })

  return normalized.length > 0 ? normalized : undefined
}

const normalizeReferenceKindFilters = (
  referenceKinds: ListReferenceItemsRequest['referenceKinds']
): Set<SelectedReference['kind']> | null => {
  if (!Array.isArray(referenceKinds) || referenceKinds.length === 0) return null
  const normalized = referenceKinds
    .map((referenceKind) => String(referenceKind || '').trim())
    .filter(
      (referenceKind): referenceKind is SelectedReference['kind'] =>
        referenceKind === 'directory' || referenceKind === 'file' || referenceKind === 'web'
    )
  return normalized.length > 0 ? new Set(normalized) : null
}

export function registerHandlers(services: {
  ingestionService: IngestionService
  embeddingService: EmbeddingService
  storageService: StorageService
  modelService: ModelService
  recordLlmIo?: (record: AiLlmIoRecord) => void
}) {
  const { ingestionService, embeddingService, storageService, modelService } = services
  const activeAiRuns = new Map<
    string,
    { cancelled: boolean; senderId: number; abortController: AbortController }
  >()
  const activeWorkspaceIndexJobs = new Set<string>()
  const activeAiApprovals = new Map<
    string,
    {
      batchId: string
      taskId: string
      itemIds: string[]
      resolve: (
        result:
          | {
              accepted: true
              decisions: Array<{
                itemId: string
                action: 'approve' | 'reject' | 'guide'
                message?: string
              }>
            }
          | { accepted: false; error: string }
      ) => void
    }
  >()
  const documentsStore = storageService.documents
  const chatStore = storageService.chat
  const llmStore = storageService.llm
  const aiRuntimeSettingsStore = storageService.aiRuntimeSettings
  const webSourceStore = storageService.webSource
  const workspaceStore = storageService.workspace
  const workspaceIndexJobStore = storageService.workspaceIndexJob
  const docxApplyService = new DocxApplyService(storageService.docxApply)
  const workspaceService = new WorkspaceSourceService()
  const workspaceKnowledgePrepareService = new WorkspaceKnowledgePrepareService({
    embeddingService,
    documentsStore
  })
  const webSourceService = new WebSourceService()

  const emitSourceListRefresh = (sender: Electron.WebContents) => {
    if (sender.isDestroyed()) return
    sender.send('source-list-refresh')
  }

  const emitSourceListRefreshToAll = () => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('source-list-refresh')
      }
    })
  }

  const emitWorkspaceIndexJobProgress = (job: WorkspaceIndexJobRecord) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('workspace-index-job-progress', job)
      }
    })
  }

  const getWorkspaceIndexJobKey = (
    workspaceId: string,
    sourceKind: WorkspaceIndexJobSourceKind
  ): string => `${workspaceId}:${sourceKind}`

  const saveAndEmitWorkspaceIndexJob = async (
    job: WorkspaceIndexJobRecord
  ): Promise<WorkspaceIndexJobRecord> => {
    await workspaceIndexJobStore.saveJob(job)
    emitWorkspaceIndexJobProgress(job)
    return job
  }

  const updateAndEmitWorkspaceIndexJob = async (
    job: WorkspaceIndexJobRecord,
    values: Partial<
      Pick<
        WorkspaceIndexJobRecord,
        | 'status'
        | 'phase'
        | 'step_index'
        | 'step_total'
        | 'total_count'
        | 'processed_count'
        | 'failed_count'
        | 'target_ids'
        | 'message'
        | 'last_error'
        | 'updated_at'
        | 'finished_at'
      >
    >
  ): Promise<WorkspaceIndexJobRecord> => {
    await workspaceIndexJobStore.updateJob(job.id, values)
    const nextJob = (await workspaceIndexJobStore.getJobById(job.id)) || {
      ...job,
      ...values
    }
    emitWorkspaceIndexJobProgress(nextJob)
    return nextJob
  }

  const createWorkspaceIndexJob = (input: {
    workspaceId: string
    sourceKind: WorkspaceIndexJobSourceKind
    action: 'scan' | 'prepare'
    phase: WorkspaceIndexJobRecord['phase']
    stepIndex: number
    stepTotal: number
    totalCount?: number
    targetIds?: string[]
    message?: string
  }): WorkspaceIndexJobRecord => {
    const now = Date.now()
    return {
      id: uuidv4(),
      workspace_id: input.workspaceId,
      source_kind: input.sourceKind,
      action: input.action,
      status: 'running',
      phase: input.phase,
      step_index: input.stepIndex,
      step_total: input.stepTotal,
      total_count: input.totalCount || 0,
      processed_count: 0,
      failed_count: 0,
      target_ids: input.targetIds || [],
      message: input.message,
      started_at: now,
      updated_at: now
    }
  }

  const pauseForE2EFixture = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
  }

  const pauseForE2EFixtureVisiblePhase = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
  }

  const waitForE2EFixtureDelay = async (phase: 'scan' | 'prepare'): Promise<void> => {
    const durationMs = getE2EFixtureWorkspaceDelayMs(phase)
    if (durationMs <= 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  }

  const hydrateWorkspaceListItem = async (
    workspace: WorkspaceSource
  ): Promise<WorkspaceListItem> => {
    await ensureWebSourcesHydrated()
    const [fileSummary, webSummary] = await Promise.all([
      workspaceStore.getWorkspaceFileSummary(workspace.id),
      webSourceStore.getWorkspaceWebSummary(workspace.id)
    ])
    return {
      ...workspace,
      file_count: fileSummary.file_count,
      web_count: webSummary.web_count
    }
  }

  const readWorkspaceTree = async (
    workspaceId: string,
    includeUnsupported = false
  ): Promise<WorkspaceTreeListResponse> => {
    const workspace = await workspaceStore.getWorkspaceById(workspaceId)
    if (!workspace) {
      return {
        items: [],
        total: 0,
        summary: workspaceStore.getEmptySummary()
      }
    }
    if (!workspace.root_path) {
      return {
        items: [],
        total: 0,
        summary: workspaceStore.getEmptySummary()
      }
    }

    const scanResult = await workspaceService.scanWorkspaceTree({
      workspaceId,
      rootPath: workspace.root_path,
      workspaceName: workspace.name
    })
    const records = await workspaceStore.listWorkspaceFileIndexRecords(workspaceId)
    const merged = workspaceService.mergeTreeWithIndex({
      entries: scanResult.entries,
      records
    })
    const visibleItems = includeUnsupported
      ? merged
      : merged.filter((item) => item.kind === 'directory' || item.supported_for_index)
    const summary = await workspaceStore.getWorkspaceFileSummary(workspaceId)
    return {
      items: visibleItems,
      total: visibleItems.length,
      summary
    }
  }

  const runFileScanJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
  }): Promise<void> => {
    let job = input.job
    const workspaceId = job.workspace_id
    try {
      const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
      if (!currentWorkspace) throw new Error('workspace not found')
      if (!currentWorkspace.root_path) throw new Error('请先设置工作文件地址')

      await waitForE2EFixtureDelay('scan')
      const existingRecords = await workspaceStore.listWorkspaceFileIndexRecords(workspaceId)
      const now = Date.now()
      const scanResult = await workspaceService.scanWorkspaceTree({
        workspaceId,
        rootPath: currentWorkspace.root_path,
        workspaceName: currentWorkspace.name,
        now
      })
      const diff = await workspaceService.diffWorkspaceTreeAgainstIndex({
        entries: scanResult.entries,
        records: existingRecords
      })

      const nextRecords: WorkspaceFileIndexRecord[] = []
      const removedDocumentIds = diff.removed
        .map((record) => record.document_id)
        .filter((documentId): documentId is string => Boolean(documentId))

      for (const item of diff.unchanged) {
        nextRecords.push(
          workspaceService.buildWorkspaceFileIndexRecord({
            workspaceId,
            entry: item.entry,
            previous: item.record,
            now
          })
        )
      }
      for (const item of diff.changed) {
        nextRecords.push({
          ...workspaceService.buildWorkspaceFileIndexRecord({
            workspaceId,
            entry: item.entry,
            previous: item.record,
            now
          }),
          content_hash: item.record.content_hash,
          index_status: 'needs_index',
          document_id: item.record.document_id,
          indexed_at: item.record.indexed_at,
          last_error: item.record.last_error
        })
      }
      for (const entry of diff.added) {
        nextRecords.push(
          workspaceService.buildWorkspaceFileIndexRecord({
            workspaceId,
            entry,
            now
          })
        )
      }

      await workspaceStore.replaceWorkspaceFileIndexRecords(workspaceId, nextRecords)
      if (removedDocumentIds.length > 0) {
        await documentsStore.deleteDocumentsByIds(removedDocumentIds)
      }
      job = await updateAndEmitWorkspaceIndexJob(job, {
        status: 'succeeded',
        phase: 'complete',
        total_count: nextRecords.length,
        processed_count: nextRecords.length,
        message: `检查完成，新增 ${diff.added.length}，变更 ${diff.changed.length}，移除 ${diff.removed.length}`,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()
      void job
    } catch (error) {
      const message = getErrorMessage(error)
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'file'))
    }
  }

  const runE2EWorkspaceIndexJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
    delayPhase?: 'scan' | 'prepare'
    run: () => WorkspaceJobResponse | null
  }): Promise<void> => {
    const job = input.job
    try {
      if (input.delayPhase) {
        await waitForE2EFixtureDelay(input.delayPhase)
      } else {
        await pauseForE2EFixture()
      }
      const response = input.run()
      if (!response?.success) {
        const message = response?.error || 'E2E fixture job failed'
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'failed',
          message,
          last_error: message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }
      const progress = response.progress
      const failedCount = progress?.failed || 0
      await updateAndEmitWorkspaceIndexJob(job, {
        status: failedCount > 0 ? 'failed' : 'succeeded',
        phase: 'complete',
        total_count: progress?.total || job.total_count,
        processed_count: progress?.completed || progress?.total || job.total_count,
        failed_count: failedCount,
        message: progress?.message || 'E2E fixture job complete',
        updated_at: Date.now(),
        finished_at: Date.now()
      })
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(job.workspace_id, job.source_kind))
    }
  }

  const runE2EWebPrepareJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
  }): Promise<void> => {
    let job = input.job
    const workspaceId = job.workspace_id
    try {
      const currentList = getE2EFixtureWebSourceList(workspaceId)
      const targets = (currentList?.items || []).filter(
        (item) =>
          item.index_status === 'needs_index' ||
          item.index_status === 'crawl_failed' ||
          item.index_status === 'index_failed'
      )
      job = await updateAndEmitWorkspaceIndexJob(job, {
        phase: targets.length > 0 ? 'crawl' : 'index',
        step_index: targets.length > 0 ? 1 : 2,
        step_total: 2,
        total_count: targets.length,
        target_ids: targets.map((item) => item.id),
        message:
          targets.length > 0
            ? `步骤 1/2 抓取网页：0/${targets.length}`
            : '步骤 2/2 建立索引：无需处理',
        updated_at: Date.now()
      })
      await waitForE2EFixtureDelay('prepare')
      if (targets.length > 0) {
        job = await updateAndEmitWorkspaceIndexJob(job, {
          processed_count: targets.length,
          message: `步骤 1/2 抓取网页：${targets.length}/${targets.length}`,
          updated_at: Date.now()
        })
      }
      job = await updateAndEmitWorkspaceIndexJob(job, {
        phase: 'index',
        step_index: 2,
        step_total: 2,
        total_count: targets.length,
        processed_count: 0,
        failed_count: 0,
        message: `步骤 2/2 建立索引：0/${targets.length}`,
        updated_at: Date.now()
      })
      await pauseForE2EFixtureVisiblePhase()

      const response = prepareE2EFixtureWebSources(workspaceId)
      if (!response?.success) {
        const message = response?.error || 'E2E fixture web prepare failed'
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'failed',
          message,
          last_error: message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }
      const progress = response.progress
      const failedCount = progress?.failed || 0
      await updateAndEmitWorkspaceIndexJob(job, {
        status: failedCount > 0 ? 'failed' : 'succeeded',
        phase: 'complete',
        total_count: progress?.total || targets.length,
        processed_count: progress?.completed || progress?.total || targets.length,
        failed_count: failedCount,
        message: progress?.message || 'E2E fixture web prepare complete',
        updated_at: Date.now(),
        finished_at: Date.now()
      })
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'web'))
    }
  }

  const collectFilePrepareTargets = async (input: {
    workspaceId: string
    workspace: WorkspaceSource
    now: number
  }): Promise<{
    targets: WorkspaceFileIndexRecord[]
    recordMap: Map<string, WorkspaceFileIndexRecord>
    added: number
    updated: number
    removed: number
  }> => {
    const scanResult = await workspaceService.scanWorkspaceTree({
      workspaceId: input.workspaceId,
      rootPath: input.workspace.root_path || '',
      workspaceName: input.workspace.name,
      now: input.now
    })
    const existingRecords = await workspaceStore.listWorkspaceFileIndexRecords(input.workspaceId)
    const diff = await workspaceService.diffWorkspaceTreeAgainstIndex({
      entries: scanResult.entries,
      records: existingRecords
    })
    const recordMap = new Map(
      existingRecords.map((record) => [record.relative_path, record] as const)
    )

    for (const item of diff.added) {
      recordMap.set(
        item.relative_path,
        workspaceService.buildWorkspaceFileIndexRecord({
          workspaceId: input.workspaceId,
          entry: item,
          now: input.now
        })
      )
    }
    for (const item of diff.changed) {
      recordMap.set(item.entry.relative_path, {
        ...workspaceService.buildWorkspaceFileIndexRecord({
          workspaceId: input.workspaceId,
          entry: item.entry,
          previous: item.record,
          now: input.now
        }),
        content_hash: item.record.content_hash,
        index_status: 'needs_index',
        document_id: item.record.document_id,
        indexed_at: item.record.indexed_at,
        last_error: item.record.last_error
      })
    }

    const removedDocumentIds = diff.removed
      .map((record) => record.document_id)
      .filter((documentId): documentId is string => Boolean(documentId))
    if (removedDocumentIds.length > 0) {
      await documentsStore.deleteDocumentsByIds(removedDocumentIds)
    }
    for (const record of diff.removed) {
      recordMap.delete(record.relative_path)
    }

    const targets = Array.from(recordMap.values()).filter(
      (record) => record.index_status === 'needs_index' || record.index_status === 'failed'
    )

    return {
      targets,
      recordMap,
      added: diff.added.length,
      updated: diff.changed.length,
      removed: diff.removed.length
    }
  }

  const runFilePrepareJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
  }): Promise<void> => {
    let job = input.job
    const workspaceId = job.workspace_id
    try {
      const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
      if (!currentWorkspace) throw new Error('workspace not found')
      if (!currentWorkspace.root_path) throw new Error('请先设置工作文件地址')

      await waitForE2EFixtureDelay('prepare')
      const prepareStartedAt = Date.now()
      const { targets, recordMap, added, updated, removed } = await collectFilePrepareTargets({
        workspaceId,
        workspace: currentWorkspace,
        now: prepareStartedAt
      })
      job = await updateAndEmitWorkspaceIndexJob(job, {
        total_count: targets.length,
        target_ids: targets.map((record) => record.id),
        message: `准备更新 ${targets.length} 个文件`,
        updated_at: Date.now()
      })

      for (const record of targets) {
        await workspaceStore.upsertWorkspaceFileIndexRecords([
          {
            ...record,
            index_status: 'indexing',
            last_error: undefined,
            last_checked_at: prepareStartedAt,
            updated_at: prepareStartedAt
          }
        ])
      }
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()

      let processed = 0
      let failed = 0
      for (const target of targets) {
        const currentRecord = recordMap.get(target.relative_path) || target
        const documentId = currentRecord.document_id || uuidv4()
        job = await updateAndEmitWorkspaceIndexJob(job, {
          message: `正在处理 ${processed + 1}/${targets.length}：${currentRecord.relative_path}`,
          updated_at: Date.now()
        })
        try {
          const indexedDocument = await workspaceKnowledgePrepareService.indexLocalFile({
            workspaceId,
            documentId,
            filePath: currentRecord.absolute_path,
            documentName: currentRecord.name
          })
          const preparedAt = Date.now()
          const preparedRecord: WorkspaceFileIndexRecord = {
            ...currentRecord,
            document_id: documentId,
            content_hash: indexedDocument.contentHash,
            index_status: 'indexed',
            indexed_at: preparedAt,
            last_checked_at: preparedAt,
            last_error: undefined,
            updated_at: preparedAt
          }
          recordMap.set(currentRecord.relative_path, preparedRecord)
          await workspaceStore.updateWorkspaceFileIndexRecord(preparedRecord.id, {
            document_id: preparedRecord.document_id,
            content_hash: preparedRecord.content_hash,
            index_status: preparedRecord.index_status,
            indexed_at: preparedRecord.indexed_at,
            last_checked_at: preparedRecord.last_checked_at,
            last_error: preparedRecord.last_error,
            updated_at: preparedRecord.updated_at
          })
        } catch (error) {
          failed += 1
          await documentsStore.updateDocumentImportStatus(documentId, 3).catch(() => {})
          const failedAt = Date.now()
          const failedRecord: WorkspaceFileIndexRecord = {
            ...currentRecord,
            document_id: documentId,
            index_status: 'failed',
            last_checked_at: failedAt,
            last_error: getErrorMessage(error),
            updated_at: failedAt
          }
          recordMap.set(currentRecord.relative_path, failedRecord)
          await workspaceStore.updateWorkspaceFileIndexRecord(failedRecord.id, {
            document_id: failedRecord.document_id,
            index_status: failedRecord.index_status,
            last_checked_at: failedRecord.last_checked_at,
            last_error: failedRecord.last_error,
            updated_at: failedRecord.updated_at
          })
        }
        processed += 1
        job = await updateAndEmitWorkspaceIndexJob(job, {
          processed_count: processed,
          failed_count: failed,
          message: `已处理 ${processed}/${targets.length}`,
          updated_at: Date.now()
        })
        emitSourceListRefresh(input.sender)
        emitSourceListRefreshToAll()
      }

      await updateAndEmitWorkspaceIndexJob(job, {
        status: failed > 0 ? 'failed' : 'succeeded',
        phase: 'complete',
        message:
          failed > 0
            ? `索引完成，失败 ${failed} 个；新增 ${added}，变更 ${updated}，移除 ${removed}`
            : `索引完成；新增 ${added}，变更 ${updated}，移除 ${removed}`,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } catch (error) {
      const message = getErrorMessage(error)
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'file'))
    }
  }

  const emitE2EChatArtifactFlow = async (input: {
    runId: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<void> => {
    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 1,
      action: 'call_tool',
      toolName: 'kb_search',
      publicNarrative: '执行检索并整理结果',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: ['kb_search'],
      summary: 'E2E fixture 开始执行检索。',
      createdAt: Date.now(),
      stage: 'human_hand'
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'tool_call_started',
      runId: input.runId,
      taskId: input.runId,
      toolCallId: 'tool-e2e-search',
      toolName: 'kb_search',
      input: {
        query: 'e2e fixture search'
      },
      createdAt: Date.now()
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'tool_call_result',
      runId: input.runId,
      taskId: input.runId,
      toolCallId: 'tool-e2e-search',
      toolName: 'kb_search',
      result: {
        toolName: 'kb_search',
        ok: true,
        data: [
          {
            id: 'chunk-e2e-1',
            text: 'E2E 检索命中内容',
            document_name: 'E2E 文档'
          }
        ]
      },
      completedAt: Date.now()
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 2,
      action: 'deliver_result',
      publicNarrative: '生成文件产物并整理最终结果',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: [],
      summary: 'E2E fixture 已生成文件产物。',
      createdAt: Date.now(),
      stage: 'human_mouth'
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.runId,
      artifactId: 'artifact-e2e-1',
      capability: 'docx',
      path: '/tmp/ncurator-e2e-result.docx',
      fileName: 'ncurator-e2e-result.docx',
      operation: 'created',
      summary: 'E2E 生成测试文档',
      createdAt: Date.now()
    })
  }

  const emitE2EDocxApplyFlow = async (input: {
    runId: string
    sendEvent: (event: AiRunEvent) => void
    multiple: boolean
    answerText?: string
  }): Promise<void> => {
    const applyEvents = input.multiple
      ? [
          {
            id: `e2e-apply-${input.runId}-a`,
            path: `/tmp/ncurator-e2e-apply-${input.runId}-a.docx`,
            fileName: 'e2e-apply-a.docx'
          },
          {
            id: `e2e-apply-${input.runId}-b`,
            path: `/tmp/ncurator-e2e-apply-${input.runId}-b.docx`,
            fileName: 'e2e-apply-b.docx'
          }
        ]
      : [
          {
            id: `e2e-apply-${input.runId}`,
            path: `/tmp/ncurator-e2e-apply-${input.runId}.docx`,
            fileName: 'e2e-apply.docx'
          }
        ]

    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 1,
      action: 'call_tool',
      toolName: 'docx_edit',
      publicNarrative: '直接修改 docx 源文件',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: ['docx_edit'],
      summary: 'E2E fixture 已准备 docx 直接写回结果。',
      createdAt: Date.now(),
      stage: 'human_hand'
    })
    await pauseForE2EFixture()

    applyEvents.forEach((item) => {
      input.sendEvent({
        type: 'file_artifact',
        runId: input.runId,
        taskId: input.runId,
        artifactId: uuidv4(),
        capability: 'docx',
        path: item.path,
        fileName: item.fileName,
        operation: 'updated',
        applyId: item.id,
        summary: `docx applied: ${item.fileName}`,
        createdAt: Date.now()
      })
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'human_step',
      runId: input.runId,
      taskId: input.runId,
      stepIndex: 2,
      action: 'deliver_result',
      publicNarrative: '整理已修改文件结果',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: [],
      summary: 'E2E fixture 已暴露 docx 直接写回结果。',
      createdAt: Date.now(),
      stage: 'human_mouth'
    })
    await pauseForE2EFixture()

    input.sendEvent({
      type: 'answer_completed',
      runId: input.runId,
      text:
        input.answerText ||
        (input.multiple
          ? 'E2E fixture 已直接修改两个 docx 文件，可分别回退。'
          : 'E2E fixture 已直接修改 docx 源文件，可回退本次修改。')
    })
    input.sendEvent({
      type: 'run_completed',
      runId: input.runId
    })
  }

  const waitForE2EApprovalDecision = async (input: {
    runId: string
    taskId: string
    sendEvent: (event: AiRunEvent) => void
  }): Promise<boolean> => {
    const batchId = 'approval-batch-e2e-1'
    const itemId = 'approval-item-e2e-1'

    input.sendEvent({
      type: 'approval_batch_required',
      runId: input.runId,
      taskId: input.taskId,
      batchId,
      items: [
        {
          itemId,
          order: 0,
          toolName: 'terminal_run',
          command: 'rm -rf /tmp/ncurator-e2e',
          reason: 'E2E fixture 需要审批才能继续'
        }
      ],
      createdAt: Date.now()
    })

    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        activeAiApprovals.delete(input.runId)
        input.sendEvent({
          type: 'approval_batch_decision',
          runId: input.runId,
          taskId: input.taskId,
          batchId,
          decisions: [
            {
              itemId,
              action: 'reject',
              message: 'e2e_fixture_timeout'
            }
          ],
          decidedAt: Date.now()
        })
        resolve(false)
      }, 10_000)

      activeAiApprovals.set(input.runId, {
        batchId,
        taskId: input.taskId,
        itemIds: [itemId],
        resolve: (result) => {
          clearTimeout(timeout)
          activeAiApprovals.delete(input.runId)
          const decisions = result.accepted
            ? result.decisions
            : [{ itemId, action: 'reject' as const, message: result.error }]
          input.sendEvent({
            type: 'approval_batch_decision',
            runId: input.runId,
            taskId: input.taskId,
            batchId,
            decisions,
            decidedAt: Date.now()
          })
          resolve(
            result.accepted && result.decisions.every((decision) => decision.action === 'approve')
          )
        }
      })
    })
  }

  const maybeHandleE2EFixtureRun = async (input: {
    runId: string
    inputText: string
    workspace?: {
      workspaceId: string
      workspaceName: string
      rootPath: string
      policyProfile?: string
    }
    sendEvent: (event: AiRunEvent) => void
    docxApplyService: DocxApplyService
  }): Promise<boolean> => {
    if (!isE2EFixtureModeEnabled()) return false

    const scenario = matchE2EChatScenario(input.inputText)
    if (!scenario) return false

    const taskId = input.runId

    if (scenario === 'chat-artifact-flow') {
      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: 'E2E fixture 已生成过程结果与文件产物。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-approval') {
      const approved = await waitForE2EApprovalDecision({
        runId: input.runId,
        taskId,
        sendEvent: input.sendEvent
      })

      if (!approved) {
        input.sendEvent({
          type: 'runtime_issue',
          runId: input.runId,
          code: 'approval_denied',
          message: 'E2E fixture 审批被拒绝',
          taskId,
          createdAt: Date.now()
        })
        input.sendEvent({
          type: 'run_completed',
          runId: input.runId
        })
        return true
      }

      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: '审批通过，E2E fixture 已继续执行。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-workspace') {
      if (!input.workspace?.rootPath) {
        input.sendEvent({
          type: 'workspace_required',
          runId: input.runId,
          taskId,
          reason: 'E2E fixture 需要工作区上下文才能继续',
          requiredFields: ['workspaceId', 'rootPath'],
          createdAt: Date.now()
        })
        return true
      }

      await emitE2EChatArtifactFlow({
        runId: input.runId,
        sendEvent: input.sendEvent
      })
      input.sendEvent({
        type: 'answer_completed',
        runId: input.runId,
        text: '工作区已补充，E2E fixture 已继续执行。'
      })
      input.sendEvent({
        type: 'run_completed',
        runId: input.runId
      })
      return true
    }

    if (scenario === 'chat-edit-apply') {
      await emitE2EDocxApplyFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        multiple: false
      })
      return true
    }

    if (scenario === 'chat-edit-apply-b') {
      await emitE2EDocxApplyFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        multiple: false,
        answerText: 'E2E fixture 已直接修改 B 文件，可回退本次修改。'
      })
      return true
    }

    if (scenario === 'chat-multi-apply') {
      await emitE2EDocxApplyFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        multiple: true
      })
      return true
    }

    if (scenario === 'chat-apply-revert-warning') {
      await emitE2EDocxApplyFlow({
        runId: input.runId,
        sendEvent: input.sendEvent,
        multiple: false
      })
      return true
    }

    return false
  }

  const ensureWebSourcesHydrated = async (): Promise<void> => {
    const existingSources = await webSourceStore.listWebSources()
    const existingByDocumentId = new Map(
      existingSources
        .filter((source) => source.document_id)
        .map((source) => [source.document_id || '', source] as const)
    )
    const webDocuments = (
      await documentsStore.listDocuments({ page: 1, pageSize: 2000 })
    ).items.filter((document) => document.source_type === 'web')

    for (const document of webDocuments) {
      if (existingByDocumentId.has(document.id)) continue
      const workspaceId = String(document.workspace_id || '').trim()
      if (!workspaceId) continue
      const rawUrl = String(document.source_url || document.file_path || document.name || '').trim()
      if (!rawUrl) continue
      try {
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(
          normalizedUrl,
          workspaceId
        )
        const now = Date.now()
        if (existing) {
          await webSourceStore.updateWebSource(existing.id, {
            workspace_id: workspaceId,
            url,
            title: document.source_title || document.name,
            document_id: document.id,
            index_status:
              document.import_status === 2
                ? 'indexed'
                : document.import_status === 3
                  ? 'index_failed'
                  : 'indexing',
            fetched_at: document.fetched_at || document.created_at,
            last_error: document.last_error,
            updated_at: now
          })
          continue
        }
        const source = webSourceService.createWebSource({
          workspaceId,
          url,
          normalizedUrl,
          title: document.source_title || document.name,
          documentId: document.id,
          indexStatus:
            document.import_status === 2
              ? 'indexed'
              : document.import_status === 3
                ? 'index_failed'
                : 'indexing',
          fetchedAt: document.fetched_at || document.created_at,
          lastCrawledAt: document.fetched_at || document.created_at,
          lastIndexedAt:
            document.import_status === 2 ? document.fetched_at || document.created_at : undefined,
          lastError: document.last_error,
          now
        })
        await webSourceStore.saveWebSource(source)
      } catch (error) {
        void error
      }
    }
  }

  const inspectWebSourceRecord = async (source: WebSourceRecord): Promise<WebSourceRecord> => {
    const now = Date.now()
    await webSourceStore.updateWebSource(source.id, {
      index_status: 'crawling',
      last_error: undefined,
      updated_at: now
    })

    try {
      const inspection = await webSourceService.inspectUrl({
        url: source.url,
        includeSelectors: source.include_selectors,
        excludeSelectors: source.exclude_selectors
      })
      const changed = !source.content_hash || source.content_hash !== inspection.contentHash
      const inspectedAt = Date.now()
      const nextSource: WebSourceRecord = {
        ...source,
        title: inspection.title || source.title,
        index_status: changed
          ? 'needs_index'
          : source.index_status === 'indexed'
            ? 'indexed'
            : 'needs_index',
        last_checked_at: inspectedAt,
        last_crawled_at: inspectedAt,
        fetched_at: source.fetched_at,
        etag: inspection.etag,
        last_modified: inspection.lastModified,
        content_length: inspection.contentLength,
        content_hash: inspection.contentHash,
        last_error: undefined,
        updated_at: inspectedAt
      }
      await webSourceStore.saveWebSource(nextSource)
      return nextSource
    } catch (error) {
      const failedAt = Date.now()
      const failedSource: WebSourceRecord = {
        ...source,
        index_status: 'crawl_failed',
        last_checked_at: failedAt,
        last_error: getErrorMessage(error),
        updated_at: failedAt
      }
      await webSourceStore.saveWebSource(failedSource)
      throw error
    }
  }

  const refreshWebSourceRecord = async (
    event: Electron.IpcMainInvokeEvent,
    source: WebSourceRecord
  ): Promise<{ source: WebSourceRecord; chunkCount: number }> => {
    const now = Date.now()
    const nextDocumentId = source.document_id || uuidv4()
    const nextPendingSource: WebSourceRecord = {
      ...source,
      document_id: nextDocumentId,
      index_status: 'crawling',
      last_error: undefined,
      updated_at: now
    }
    await webSourceStore.saveWebSource(nextPendingSource)

    const existingDocument = source.document_id
      ? await documentsStore.getDocumentById(source.document_id)
      : null
    if (existingDocument) {
      await documentsStore.updateDocumentById(existingDocument.id, {
        name: source.title || source.url,
        file_path: source.url,
        source_type: 'web',
        workspace_id: source.workspace_id
      })
      await documentsStore.updateDocumentImportStatus(existingDocument.id, 1)
      await documentsStore.deleteChunksByDocumentIds([existingDocument.id])
    } else {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        workspace_id: source.workspace_id,
        file_path: source.url,
        created_at: now,
        import_status: 1,
        source_id: source.id,
        source_url: source.url,
        source_title: source.title,
        normalized_source_url: source.normalized_url
      })
    }

    emitSourceListRefresh(event.sender)

    let inspection: Awaited<ReturnType<WebSourceService['inspectUrl']>>
    try {
      inspection = await webSourceService.inspectUrl({
        url: source.url,
        includeSelectors: source.include_selectors,
        excludeSelectors: source.exclude_selectors
      })
    } catch (error) {
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 3).catch(() => {})
      const failedAt = Date.now()
      const failedSource: WebSourceRecord = {
        ...nextPendingSource,
        index_status: 'crawl_failed',
        last_checked_at: failedAt,
        last_error: getErrorMessage(error),
        updated_at: failedAt
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(event.sender)
      throw error
    }

    const crawledAt = Date.now()
    const crawlingDoneSource: WebSourceRecord = {
      ...nextPendingSource,
      title: inspection.title || nextPendingSource.title,
      index_status: 'indexing',
      last_checked_at: crawledAt,
      last_crawled_at: crawledAt,
      etag: inspection.etag,
      last_modified: inspection.lastModified,
      content_length: inspection.contentLength,
      content_hash: inspection.contentHash,
      updated_at: crawledAt
    }
    await webSourceStore.saveWebSource(crawlingDoneSource)
    emitSourceListRefresh(event.sender)

    try {
      const splitDocs = await ingestionService.processWebText({
        url: source.url,
        title: inspection.title,
        text: inspection.text
      })
      const documentName = splitDocs.title?.trim() || source.url
      await documentsStore.updateDocumentById(nextDocumentId, {
        name: documentName,
        file_path: source.url,
        source_type: 'web',
        workspace_id: source.workspace_id
      })

      const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
      const allChunkVectors: Float32Array[] = []
      for (const doc of allSplitDocs) {
        const { data: vector } = await embeddingService.embed(doc.pageContent)
        allChunkVectors.push(vector)
      }

      const chunks = allChunkVectors.map((_, index) => ({
        text: allSplitDocs[index].pageContent,
        id: uuidv4(),
        document_id: nextDocumentId,
        workspace_id: source.workspace_id,
        document_name: documentName,
        source_type: 'web',
        metadata: {
          page: 1
        }
      }))

      await documentsStore.addChunks({
        vectors: allChunkVectors,
        chunks
      })
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 2)

      const refreshedSource: WebSourceRecord = {
        ...crawlingDoneSource,
        title: documentName,
        index_status: 'indexed',
        fetched_at: Date.now(),
        last_indexed_at: Date.now(),
        last_error: undefined,
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(refreshedSource)
      emitSourceListRefresh(event.sender)
      return { source: refreshedSource, chunkCount: chunks.length }
    } catch (error) {
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 3).catch(() => {})
      const failedSource: WebSourceRecord = {
        ...crawlingDoneSource,
        index_status: 'index_failed',
        last_error: getErrorMessage(error),
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(event.sender)
      throw error
    }
  }

  const crawlWebSourceForIndexJob = async (
    sender: Electron.WebContents,
    source: WebSourceRecord
  ): Promise<{
    source: WebSourceRecord
    documentId: string
    inspection: Awaited<ReturnType<WebSourceService['inspectUrl']>>
  }> => {
    const now = Date.now()
    const nextDocumentId = source.document_id || uuidv4()
    const nextPendingSource: WebSourceRecord = {
      ...source,
      document_id: nextDocumentId,
      index_status: 'crawling',
      last_error: undefined,
      updated_at: now
    }
    await webSourceStore.saveWebSource(nextPendingSource)

    const existingDocument = source.document_id
      ? await documentsStore.getDocumentById(source.document_id)
      : null
    if (existingDocument) {
      await documentsStore.updateDocumentById(existingDocument.id, {
        name: source.title || source.url,
        file_path: source.url,
        source_type: 'web',
        workspace_id: source.workspace_id
      })
      await documentsStore.updateDocumentImportStatus(existingDocument.id, 1)
      await documentsStore.deleteChunksByDocumentIds([existingDocument.id])
    } else {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        workspace_id: source.workspace_id,
        file_path: source.url,
        created_at: now,
        import_status: 1,
        source_id: source.id,
        source_url: source.url,
        source_title: source.title,
        normalized_source_url: source.normalized_url
      })
    }

    emitSourceListRefresh(sender)
    emitSourceListRefreshToAll()

    try {
      const inspection = await webSourceService.inspectUrl({
        url: source.url,
        includeSelectors: source.include_selectors,
        excludeSelectors: source.exclude_selectors
      })
      const crawledAt = Date.now()
      const crawlingDoneSource: WebSourceRecord = {
        ...nextPendingSource,
        title: inspection.title || nextPendingSource.title,
        index_status: 'indexing',
        last_checked_at: crawledAt,
        last_crawled_at: crawledAt,
        etag: inspection.etag,
        last_modified: inspection.lastModified,
        content_length: inspection.contentLength,
        content_hash: inspection.contentHash,
        updated_at: crawledAt
      }
      await webSourceStore.saveWebSource(crawlingDoneSource)
      emitSourceListRefresh(sender)
      emitSourceListRefreshToAll()
      return { source: crawlingDoneSource, documentId: nextDocumentId, inspection }
    } catch (error) {
      await documentsStore.updateDocumentImportStatus(nextDocumentId, 3).catch(() => {})
      const failedAt = Date.now()
      const failedSource: WebSourceRecord = {
        ...nextPendingSource,
        index_status: 'crawl_failed',
        last_checked_at: failedAt,
        last_error: getErrorMessage(error),
        updated_at: failedAt
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(sender)
      emitSourceListRefreshToAll()
      throw error
    }
  }

  const indexCrawledWebSourceForIndexJob = async (input: {
    sender: Electron.WebContents
    source: WebSourceRecord
    documentId: string
    inspection: Awaited<ReturnType<WebSourceService['inspectUrl']>>
  }): Promise<void> => {
    try {
      const splitDocs = await ingestionService.processWebText({
        url: input.source.url,
        title: input.inspection.title,
        text: input.inspection.text
      })
      const documentName = splitDocs.title?.trim() || input.source.url
      await documentsStore.updateDocumentById(input.documentId, {
        name: documentName,
        file_path: input.source.url,
        source_type: 'web',
        workspace_id: input.source.workspace_id
      })

      const allSplitDocs = [...splitDocs.bigSplitDocs, ...splitDocs.miniSplitDocs]
      const allChunkVectors: Float32Array[] = []
      for (const doc of allSplitDocs) {
        const { data: vector } = await embeddingService.embed(doc.pageContent)
        allChunkVectors.push(vector)
      }

      const chunks = allChunkVectors.map((_, index) => ({
        text: allSplitDocs[index].pageContent,
        id: uuidv4(),
        document_id: input.documentId,
        workspace_id: input.source.workspace_id,
        document_name: documentName,
        source_type: 'web',
        metadata: {
          page: 1
        }
      }))

      await documentsStore.addChunks({
        vectors: allChunkVectors,
        chunks
      })
      await documentsStore.updateDocumentImportStatus(input.documentId, 2)

      const indexedAt = Date.now()
      const refreshedSource: WebSourceRecord = {
        ...input.source,
        title: documentName,
        index_status: 'indexed',
        fetched_at: indexedAt,
        last_indexed_at: indexedAt,
        last_error: undefined,
        updated_at: indexedAt
      }
      await webSourceStore.saveWebSource(refreshedSource)
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()
    } catch (error) {
      await documentsStore.updateDocumentImportStatus(input.documentId, 3).catch(() => {})
      const failedSource: WebSourceRecord = {
        ...input.source,
        index_status: 'index_failed',
        last_error: getErrorMessage(error),
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(failedSource)
      emitSourceListRefresh(input.sender)
      emitSourceListRefreshToAll()
      throw error
    }
  }

  const runWebScanJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
  }): Promise<void> => {
    let job = input.job
    const workspaceId = job.workspace_id
    try {
      await ensureWebSourcesHydrated()
      const sources = await webSourceStore.listWebSources(workspaceId)
      job = await updateAndEmitWorkspaceIndexJob(job, {
        total_count: sources.length,
        target_ids: sources.map((source) => source.id),
        message: `准备检查 ${sources.length} 个网页`,
        updated_at: Date.now()
      })
      let processed = 0
      let failed = 0
      for (const source of sources) {
        try {
          await inspectWebSourceRecord(source)
        } catch (error) {
          void error
          failed += 1
        }
        processed += 1
        job = await updateAndEmitWorkspaceIndexJob(job, {
          processed_count: processed,
          failed_count: failed,
          message: `已检查 ${processed}/${sources.length}`,
          updated_at: Date.now()
        })
        emitSourceListRefresh(input.sender)
        emitSourceListRefreshToAll()
      }
      await updateAndEmitWorkspaceIndexJob(job, {
        status: failed > 0 ? 'failed' : 'succeeded',
        phase: 'complete',
        message: failed > 0 ? `检查完成，失败 ${failed} 个` : '检查完成',
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } catch (error) {
      const message = getErrorMessage(error)
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'web'))
    }
  }

  const runWebPrepareJob = async (input: {
    sender: Electron.WebContents
    job: WorkspaceIndexJobRecord
  }): Promise<void> => {
    let job = input.job
    const workspaceId = job.workspace_id
    try {
      await ensureWebSourcesHydrated()
      const sources = await webSourceStore.listWebSources(workspaceId)
      const targets = sources.filter(
        (source) =>
          source.index_status === 'needs_index' ||
          source.index_status === 'crawl_failed' ||
          source.index_status === 'index_failed'
      )
      job = await updateAndEmitWorkspaceIndexJob(job, {
        phase: targets.length > 0 ? 'crawl' : 'index',
        step_index: targets.length > 0 ? 1 : 2,
        step_total: 2,
        total_count: targets.length,
        target_ids: targets.map((source) => source.id),
        message:
          targets.length > 0
            ? `步骤 1/2 抓取网页：0/${targets.length}`
            : '步骤 2/2 建立索引：无需处理',
        updated_at: Date.now()
      })

      const crawledSources: Array<{
        source: WebSourceRecord
        documentId: string
        inspection: Awaited<ReturnType<WebSourceService['inspectUrl']>>
      }> = []
      let crawlProcessed = 0
      let crawlFailed = 0
      const concurrency = Math.max(1, WEB_INGEST_CONCURRENCY)
      let crawlIndex = 0
      const runCrawlOne = async (): Promise<void> => {
        for (;;) {
          const current = targets[crawlIndex++]
          if (!current) return
          try {
            const crawled = await crawlWebSourceForIndexJob(input.sender, current)
            crawledSources.push(crawled)
          } catch (error) {
            void error
            crawlFailed += 1
          }
          crawlProcessed += 1
          job = await updateAndEmitWorkspaceIndexJob(job, {
            processed_count: crawlProcessed,
            failed_count: crawlFailed,
            message: `步骤 1/2 抓取网页：${crawlProcessed}/${targets.length}`,
            updated_at: Date.now()
          })
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => runCrawlOne()))

      job = await updateAndEmitWorkspaceIndexJob(job, {
        phase: 'index',
        step_index: 2,
        step_total: 2,
        total_count: crawledSources.length,
        processed_count: 0,
        failed_count: 0,
        target_ids: crawledSources.map((item) => item.source.id),
        message: `步骤 2/2 建立索引：0/${crawledSources.length}`,
        updated_at: Date.now()
      })

      let indexProcessed = 0
      let indexFailed = 0
      let indexIndex = 0
      const runIndexOne = async (): Promise<void> => {
        for (;;) {
          const current = crawledSources[indexIndex++]
          if (!current) return
          try {
            await indexCrawledWebSourceForIndexJob({
              sender: input.sender,
              source: current.source,
              documentId: current.documentId,
              inspection: current.inspection
            })
          } catch (error) {
            void error
            indexFailed += 1
          }
          indexProcessed += 1
          job = await updateAndEmitWorkspaceIndexJob(job, {
            processed_count: indexProcessed,
            failed_count: indexFailed,
            message: `步骤 2/2 建立索引：${indexProcessed}/${crawledSources.length}`,
            updated_at: Date.now()
          })
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => runIndexOne()))

      const totalFailed = crawlFailed + indexFailed
      await updateAndEmitWorkspaceIndexJob(job, {
        status: totalFailed > 0 ? 'failed' : 'succeeded',
        phase: 'complete',
        total_count: targets.length,
        processed_count: targets.length,
        failed_count: totalFailed,
        message: totalFailed > 0 ? `网页索引完成，失败 ${totalFailed} 个` : '网页索引完成',
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } catch (error) {
      const message = getErrorMessage(error)
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'web'))
    }
  }

  ipcMain.handle(
    'ingest-web',
    async (
      event,
      payload: {
        workspaceId: string
        url: string
        includeSelectors?: string[]
        excludeSelectors?: string[]
      }
    ) => {
      try {
        const fixtureResponse = ingestE2EFixtureWebSource(payload)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        const workspaceId = String(payload?.workspaceId || '').trim()
        const rawUrl = String(payload?.url || '').trim()
        if (!workspaceId) throw new Error('workspaceId 不能为空')
        if (!rawUrl) throw new Error('URL 不能为空')
        const workspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!workspace) throw new Error('工作区不存在')
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(
          normalizedUrl,
          workspaceId
        )
        const source =
          existing ||
          webSourceService.createWebSource({
            workspaceId,
            url,
            normalizedUrl,
            includeSelectors: payload.includeSelectors,
            excludeSelectors: payload.excludeSelectors,
            indexStatus: 'needs_index'
          })
        const nextSource: WebSourceRecord = {
          ...source,
          workspace_id: workspaceId,
          url,
          normalized_url: normalizedUrl,
          include_selectors: payload.includeSelectors,
          exclude_selectors: payload.excludeSelectors,
          index_status: 'needs_index',
          last_error: undefined,
          updated_at: Date.now()
        }
        if (!existing) {
          await webSourceStore.saveWebSource(nextSource)
        } else {
          await webSourceStore.updateWebSource(existing.id, {
            url,
            include_selectors: payload.includeSelectors,
            exclude_selectors: payload.excludeSelectors,
            index_status: 'needs_index',
            last_error: undefined,
            updated_at: nextSource.updated_at
          })
        }
        emitSourceListRefresh(event.sender)
        return {
          success: true,
          count: 0,
          source: nextSource
        }
      } catch (error) {
        console.error('❌ [INGEST-WEB] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'ingest-webs',
    async (
      event,
      payload: Array<{
        workspaceId: string
        url: string
        includeSelectors?: string[]
        excludeSelectors?: string[]
      }>
    ) => {
      try {
        const fixtureResponse = ingestE2EFixtureWebSources(payload)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        const items = Array.isArray(payload) ? payload : []
        const preparedSources: WebSourceRecord[] = []

        for (const item of items) {
          const workspaceId = String(item?.workspaceId || '').trim()
          const rawUrl = String(item?.url || '').trim()
          if (!workspaceId || !rawUrl) continue
          const workspace = await workspaceStore.getWorkspaceById(workspaceId)
          if (!workspace) continue
          const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
          const existing = await webSourceStore.getWebSourceByNormalizedUrl(
            normalizedUrl,
            workspaceId
          )
          const source =
            existing ||
            webSourceService.createWebSource({
              workspaceId,
              url,
              normalizedUrl,
              includeSelectors: item.includeSelectors,
              excludeSelectors: item.excludeSelectors,
              indexStatus: 'needs_index'
            })
          const nextSource: WebSourceRecord = {
            ...source,
            workspace_id: workspaceId,
            url,
            normalized_url: normalizedUrl,
            include_selectors: item.includeSelectors,
            exclude_selectors: item.excludeSelectors,
            index_status: 'needs_index',
            last_error: undefined,
            updated_at: Date.now()
          }
          if (!existing) {
            await webSourceStore.saveWebSource(nextSource)
          } else {
            await webSourceStore.updateWebSource(existing.id, {
              url,
              include_selectors: item.includeSelectors,
              exclude_selectors: item.excludeSelectors,
              index_status: 'needs_index',
              last_error: undefined,
              updated_at: nextSource.updated_at
            })
          }
          preparedSources.push(nextSource)
        }

        emitSourceListRefresh(event.sender)
        return { success: true, created: preparedSources.length }
      } catch (error) {
        console.error('❌ [INGEST-WEBS] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(String(url))
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: '仅支持 http/https URL' }
      }
      if (isE2EFixtureModeEnabled()) {
        return { success: true }
      }
      await shell.openExternal(parsed.toString())
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('open-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      const err = await shell.openPath(resolved)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'open-path-with-application',
    async (
      _event,
      payload: OpenPathWithApplicationRequest
    ): Promise<OpenPathWithApplicationResponse> => {
      try {
        const filePath = path.resolve(String(payload?.filePath || '').trim())
        const appPath = path.resolve(String(payload?.appPath || '').trim())
        if (!filePath || !appPath) {
          return { success: false, error: 'filePath and appPath are required' }
        }
        if (!fs.existsSync(filePath)) return { success: false, error: 'file path not found' }
        if (!fs.existsSync(appPath)) return { success: false, error: 'application not found' }
        if (process.platform !== 'darwin') {
          return { success: false, error: 'open with application currently supports macOS only' }
        }

        await execFileAsync('/usr/bin/open', ['-a', appPath, filePath])
        return { success: true }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('reveal-path', async (_event, rawPath: string) => {
    try {
      const value = String(rawPath || '').trim()
      if (!value) return { success: false, error: 'path is required' }
      const resolved = path.resolve(value)
      if (!fs.existsSync(resolved)) return { success: false, error: 'path not found' }
      shell.showItemInFolder(resolved)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('pick-directory', async (event): Promise<PickDirectoryResponse> => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: '选择工作空间目录',
        buttonLabel: '选择此目录',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
      }
      let result
      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender)
        result = ownerWindow
          ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
      } catch {
        result = await dialog.showOpenDialog(dialogOptions)
      }
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }
      return { canceled: false, path: result.filePaths[0] }
    } catch (error) {
      return { canceled: true, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('pick-application', async (event): Promise<PickApplicationResponse> => {
    try {
      if (process.platform !== 'darwin') {
        return { canceled: true, error: 'pick application currently supports macOS only' }
      }
      const dialogOptions: OpenDialogOptions = {
        title: '选择要打开文件的应用',
        buttonLabel: '选择此应用',
        defaultPath: '/Applications',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'Applications', extensions: ['app'] }]
      }
      let result
      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender)
        result = ownerWindow
          ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
      } catch {
        result = await dialog.showOpenDialog(dialogOptions)
      }
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }
      return { canceled: false, appPath: result.filePaths[0] }
    } catch (error) {
      return { canceled: true, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('workspace-list', async (): Promise<WorkspaceListResponse> => {
    try {
      const fixtureList = getE2EFixtureWorkspaceList()
      if (fixtureList) return fixtureList
      const workspaces = await workspaceStore.listWorkspaces()
      const items = await Promise.all(
        workspaces.map((workspace) => hydrateWorkspaceListItem(workspace))
      )
      return { items, total: items.length }
    } catch (error) {
      console.error('❌ [WORKSPACE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
  })

  ipcMain.handle(
    'workspace-create',
    async (event, payload: CreateWorkspaceSourceRequest): Promise<WorkspaceMutationResponse> => {
      try {
        const fixtureRootPath = String(
          (payload as CreateWorkspaceSourceRequest & { rootPath?: string })?.rootPath || ''
        ).trim()
        const fixtureCreate = createE2EFixtureWorkspace({
          rootPath: fixtureRootPath,
          name: payload.name
        })
        if (fixtureCreate) {
          emitSourceListRefresh(event.sender)
          return fixtureCreate
        }
        const name = String(payload.name || '').trim()
        if (!name) {
          return { success: false, error: '工作空间名称不能为空' }
        }
        const workspaceId = uuidv4()
        const now = Date.now()
        const workspace: WorkspaceSource = {
          id: workspaceId,
          name,
          created_at: now,
          updated_at: now
        }
        await workspaceStore.saveWorkspace(workspace)
        emitSourceListRefresh(event.sender)
        return {
          success: true,
          workspace
        }
      } catch (error) {
        console.error('❌ [WORKSPACE-CREATE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-delete',
    async (event, workspaceId: string): Promise<DeleteWorkspaceSourceResponse> => {
      try {
        const fixtureResponse = deleteE2EFixtureWorkspace(String(workspaceId || '').trim())
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await workspaceStore.deleteWorkspace(String(workspaceId || '').trim())
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWorkspaceId: String(workspaceId || '').trim() }
      } catch (error) {
        console.error('❌ [WORKSPACE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-set-root-path',
    async (event, payload: SetWorkspaceRootPathRequest): Promise<WorkspaceMutationResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const rootPath = String(payload?.rootPath || '').trim()
        if (!workspaceId) return { success: false, error: 'workspaceId is required' }
        if (!rootPath) return { success: false, error: '文件目录不能为空' }

        const fixtureResponse = setE2EFixtureWorkspaceRootPath(workspaceId, rootPath)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }

        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        const existingWorkspaces = await workspaceStore.listWorkspaces()
        await workspaceService.assertNoNestedWorkspace(
          rootPath,
          existingWorkspaces
            .filter((workspace) => workspace.id !== workspaceId && workspace.root_path)
            .map((workspace) => workspace.root_path || '')
        )

        const now = Date.now()
        const scanResult = await workspaceService.scanWorkspaceTree({
          workspaceId,
          rootPath,
          workspaceName: currentWorkspace.name,
          now
        })
        const supportedEntries = scanResult.entries.filter(
          (entry) => entry.kind === 'file' && entry.supported_for_index
        )
        const records = supportedEntries.map((entry) =>
          workspaceService.buildWorkspaceFileIndexRecord({
            workspaceId,
            entry,
            now
          })
        )
        await workspaceStore.replaceWorkspaceFileIndexRecords(workspaceId, records)
        const workspace: WorkspaceSource = {
          ...currentWorkspace,
          root_path: scanResult.workspace.root_path,
          updated_at: now
        }
        await workspaceStore.saveWorkspace(workspace)
        emitSourceListRefresh(event.sender)
        return { success: true, workspace }
      } catch (error) {
        console.error('❌ [WORKSPACE-SET-ROOT-PATH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-tree',
    async (_event, payload: ListWorkspaceTreeRequest): Promise<WorkspaceTreeListResponse> => {
      try {
        const fixtureTree = getE2EFixtureWorkspaceTree(
          String(payload.workspaceId || '').trim(),
          Boolean(payload.includeUnsupported)
        )
        if (fixtureTree) return fixtureTree
        return await readWorkspaceTree(
          String(payload.workspaceId || '').trim(),
          Boolean(payload.includeUnsupported)
        )
      } catch (error) {
        console.error('❌ [WORKSPACE-TREE] ERROR:', error)
        return { items: [], total: 0, summary: workspaceStore.getEmptySummary() }
      }
    }
  )

  ipcMain.handle(
    'workspace-scan',
    async (event, payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => {
      try {
        const workspaceId = String(payload.workspaceId || '').trim()
        if (!workspaceId) return { success: false, error: 'workspaceId is required' }
        if (isE2EFixtureModeEnabled()) {
          const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
          const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
          if (activeJob) return { success: true, workspaceId, job: activeJob }
          const job = await saveAndEmitWorkspaceIndexJob(
            createWorkspaceIndexJob({
              workspaceId,
              sourceKind: 'file',
              action: 'scan',
              phase: 'scan',
              stepIndex: 1,
              stepTotal: 1,
              message: '正在检查目录变化'
            })
          )
          activeWorkspaceIndexJobs.add(jobKey)
          void runE2EWorkspaceIndexJob({
            sender: event.sender,
            job,
            delayPhase: 'scan',
            run: () => scanE2EFixtureWorkspace(workspaceId)
          })
          return { success: true, workspaceId, job }
        }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
        if (activeJob) return { success: true, workspaceId, job: activeJob }
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        if (!currentWorkspace.root_path) {
          return { success: false, error: '请先设置工作文件地址' }
        }

        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
        if (activeWorkspaceIndexJobs.has(jobKey)) {
          const runningJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
          if (runningJob) return { success: true, workspaceId, job: runningJob }
          return { success: false, workspaceId, error: 'workspace file job already running' }
        }
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'file',
            action: 'scan',
            phase: 'scan',
            stepIndex: 1,
            stepTotal: 1,
            message: '正在检查目录变化'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runFileScanJob({ sender: event.sender, job })
        return { success: true, workspaceId, job }
      } catch (error) {
        console.error('❌ [WORKSPACE-SCAN] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-prepare',
    async (event, payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => {
      const workspaceId = String(payload.workspaceId || '').trim()
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      try {
        if (isE2EFixtureModeEnabled()) {
          const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
          if (activeJob) return { success: true, workspaceId, job: activeJob }
          const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
          const job = await saveAndEmitWorkspaceIndexJob(
            createWorkspaceIndexJob({
              workspaceId,
              sourceKind: 'file',
              action: 'prepare',
              phase: 'index',
              stepIndex: 1,
              stepTotal: 1,
              message: '正在准备文件索引'
            })
          )
          activeWorkspaceIndexJobs.add(jobKey)
          void runE2EWorkspaceIndexJob({
            sender: event.sender,
            job,
            delayPhase: 'prepare',
            run: () => prepareE2EFixtureWorkspace(workspaceId)
          })
          return { success: true, workspaceId, job }
        }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
        if (activeJob) return { success: true, workspaceId, job: activeJob }

        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        if (!currentWorkspace.root_path) {
          return { success: false, error: '请先设置工作文件地址' }
        }

        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
        if (activeWorkspaceIndexJobs.has(jobKey)) {
          const runningJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
          if (runningJob) return { success: true, workspaceId, job: runningJob }
          return { success: false, workspaceId, error: 'workspace file job already running' }
        }
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'file',
            action: 'prepare',
            phase: 'index',
            stepIndex: 1,
            stepTotal: 1,
            message: '正在准备文件索引'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runFilePrepareJob({ sender: event.sender, job })
        return { success: true, workspaceId, job }
      } catch (error) {
        return { success: false, error: getErrorMessage(error), workspaceId }
      }
    }
  )

  ipcMain.handle(
    'web-source-list',
    async (_event, payload: ListWebSourcesRequest): Promise<WebSourceListResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        if (!workspaceId) {
          return {
            items: [],
            total: 0,
            summary: { web_count: 0, needs_index_count: 0, failed_count: 0 }
          }
        }
        const fixtureList = getE2EFixtureWebSourceList(workspaceId)
        if (fixtureList) return fixtureList
        await ensureWebSourcesHydrated()
        const [items, summary] = await Promise.all([
          webSourceStore.listWebSources(workspaceId),
          webSourceStore.getWorkspaceWebSummary(workspaceId)
        ])
        return { items, total: items.length, summary }
      } catch (error) {
        console.error('❌ [WEB-SOURCE-LIST] ERROR:', error)
        return {
          items: [],
          total: 0,
          summary: { web_count: 0, needs_index_count: 0, failed_count: 0 }
        }
      }
    }
  )

  ipcMain.handle(
    'workspace-index-job-get',
    async (_event, payload: WorkspaceIndexJobGetRequest): Promise<WorkspaceIndexJobResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const sourceKind = payload?.sourceKind === 'web' ? 'web' : 'file'
        if (!workspaceId) return { success: false, error: 'workspaceId is required' }
        const job = await workspaceIndexJobStore.getActiveJob(workspaceId, sourceKind)
        return { success: true, job: job || undefined }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-sources-scan',
    async (event, payload: ScanWebSourcesRequest): Promise<WorkspaceJobResponse> => {
      const workspaceId = String(payload?.workspaceId || '').trim()
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      try {
        if (isE2EFixtureModeEnabled()) {
          const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
          if (activeJob) return { success: true, workspaceId, job: activeJob }
          const jobKey = getWorkspaceIndexJobKey(workspaceId, 'web')
          const job = await saveAndEmitWorkspaceIndexJob(
            createWorkspaceIndexJob({
              workspaceId,
              sourceKind: 'web',
              action: 'scan',
              phase: 'scan',
              stepIndex: 1,
              stepTotal: 1,
              message: '正在检查网页更新'
            })
          )
          activeWorkspaceIndexJobs.add(jobKey)
          void runE2EWorkspaceIndexJob({
            sender: event.sender,
            job,
            run: () => scanE2EFixtureWebSources(workspaceId)
          })
          return { success: true, workspaceId, job }
        }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
        if (activeJob) return { success: true, workspaceId, job: activeJob }
        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'web')
        if (activeWorkspaceIndexJobs.has(jobKey)) {
          const runningJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
          if (runningJob) return { success: true, workspaceId, job: runningJob }
          return { success: false, workspaceId, error: 'workspace web job already running' }
        }
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'web',
            action: 'scan',
            phase: 'scan',
            stepIndex: 1,
            stepTotal: 1,
            message: '正在检查网页更新'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runWebScanJob({ sender: event.sender, job })
        return { success: true, workspaceId, job }
      } catch (error) {
        return { success: false, workspaceId, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-sources-prepare',
    async (event, payload: PrepareWebSourcesRequest): Promise<WorkspaceJobResponse> => {
      const workspaceId = String(payload?.workspaceId || '').trim()
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      try {
        if (isE2EFixtureModeEnabled()) {
          const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
          if (activeJob) return { success: true, workspaceId, job: activeJob }
          const jobKey = getWorkspaceIndexJobKey(workspaceId, 'web')
          const job = await saveAndEmitWorkspaceIndexJob(
            createWorkspaceIndexJob({
              workspaceId,
              sourceKind: 'web',
              action: 'prepare',
              phase: 'crawl',
              stepIndex: 1,
              stepTotal: 2,
              message: '正在准备网页索引'
            })
          )
          activeWorkspaceIndexJobs.add(jobKey)
          void runE2EWebPrepareJob({
            sender: event.sender,
            job
          })
          return { success: true, workspaceId, job }
        }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
        if (activeJob) return { success: true, workspaceId, job: activeJob }
        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'web')
        if (activeWorkspaceIndexJobs.has(jobKey)) {
          const runningJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
          if (runningJob) return { success: true, workspaceId, job: runningJob }
          return { success: false, workspaceId, error: 'workspace web job already running' }
        }
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'web',
            action: 'prepare',
            phase: 'crawl',
            stepIndex: 1,
            stepTotal: 2,
            message: '正在准备网页索引'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runWebPrepareJob({ sender: event.sender, job })
        return { success: true, workspaceId, job }
      } catch (error) {
        return { success: false, workspaceId, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('legacy-local-import-migration-status', async () => {
    return storageService.getLegacyLocalImportMigrationStatus()
  })

  ipcMain.handle(
    'web-source-refresh',
    async (event, payload: RefreshWebSourceRequest): Promise<WebSourceMutationResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const webSourceId = String(payload?.webSourceId || '').trim()
        const fixtureResponse = refreshE2EFixtureWebSource(workspaceId, webSourceId)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        if (!workspaceId || !webSourceId) {
          return { success: false, error: 'workspaceId and webSourceId are required' }
        }
        const source = await webSourceStore.getWebSourceById(webSourceId, workspaceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        const refreshed = await refreshWebSourceRecord(event, source)
        return { success: true, source: refreshed.source }
      } catch (error) {
        console.error('❌ [WEB-SOURCE-REFRESH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-source-delete',
    async (event, payload: DeleteWebSourceRequest): Promise<DeleteWebSourceResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const safeId = String(payload?.webSourceId || '').trim()
        const fixtureResponse = deleteE2EFixtureWebSource(workspaceId, safeId)
        if (fixtureResponse) {
          emitSourceListRefresh(event.sender)
          return fixtureResponse
        }
        await ensureWebSourcesHydrated()
        if (!workspaceId || !safeId) {
          return { success: false, error: 'workspaceId and webSourceId are required' }
        }
        const source = await webSourceStore.getWebSourceById(safeId, workspaceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        if (source.document_id) {
          await documentsStore.deleteDocumentsByIds([source.document_id])
        }
        await webSourceStore.deleteWebSource(safeId, workspaceId)
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWebSourceId: safeId }
      } catch (error) {
        console.error('❌ [WEB-SOURCE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'reference-item-list',
    async (_event, payload: ListReferenceItemsRequest): Promise<ReferenceItemListResponse> => {
      try {
        const e2eReferences = getE2EFixtureReferenceItems(payload)
        if (e2eReferences) {
          return e2eReferences
        }

        await ensureWebSourcesHydrated()
        const workspaceIdFilter = String(payload.workspaceId || '').trim()
        const referenceKindFilters = normalizeReferenceKindFilters(payload.referenceKinds)
        const localReferences: SelectedReference[] = []

        if (workspaceIdFilter) {
          const workspace = await workspaceStore.getWorkspaceById(workspaceIdFilter)
          if (workspace) {
            const tree = await readWorkspaceTree(workspace.id, false)
            const records = await workspaceStore.listWorkspaceFileIndexRecords(workspace.id)
            localReferences.push(
              ...buildWorkspaceReferenceItems({
                workspace,
                entries: tree.items,
                records
              })
            )
          }
        }

        const webReferences = workspaceIdFilter
          ? (await webSourceStore.listWebSources(workspaceIdFilter)).map(buildWebReferenceItem)
          : []

        const allReferences = [...localReferences, ...webReferences]
          .filter((reference) => referenceMatchesQuery(reference, payload.query))
          .filter((reference) =>
            referenceKindFilters ? referenceKindFilters.has(reference.kind) : true
          )
          .filter((reference) =>
            payload.mode === 'search' ? shouldIncludeReferenceInSearch(reference) : true
          )

        return { items: allReferences, total: allReferences.length }
      } catch (error) {
        console.error('❌ [REFERENCE-ITEM-LIST] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'search',
    async (_event, query: string, sourceType?: 'all' | 'file' | 'web', documentIds?: string[]) => {
      try {
        const fixtureSearch = getE2EFixtureSearchResponse(query, documentIds)
        if (fixtureSearch) {
          return fixtureSearch
        }
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.search(
          queryVector,
          query,
          5,
          filter,
          undefined,
          documentIds
        )

        const tokens = jieba.cutForSearch(query, true)

        const finalResults = results.map(normalizeForIpc)

        return {
          results: finalResults,
          tokens
        }
      } catch (error) {
        console.error('❌ [SEARCH] ERROR:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    'fts-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.ftsSearch(query, 20, filter, undefined, documentIds)
        const normalized = results.map(normalizeForIpc)
        // console.log('🔎 [FTS-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error) {
        console.error('❌ [FTS-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'vector-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.vectorSearch(
          queryVector,
          20,
          filter,
          undefined,
          documentIds
        )
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [VECTOR-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error) {
        console.error('❌ [VECTOR-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'hybrid-search',
    async (
      _event,
      query: string,
      sourceType?: 'all' | 'file' | 'web',
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const { data: queryVector } = await embeddingService.embed(query)
        const filter = sourceType && sourceType !== 'all' ? sourceType : undefined
        const results = await documentsStore.hybridSearch(
          queryVector,
          query,
          20,
          filter,
          undefined,
          documentIds
        )
        const normalized = results.map(normalizeForIpc)
        console.log('🔎 [HYBRID-SEARCH] RESULTS:', normalized)
        return normalized
      } catch (error) {
        console.error('❌ [HYBRID-SEARCH] ERROR:', error)
        return []
      }
    }
  )

  ipcMain.handle(
    'list-documents',
    async (
      _event,
      payload: { sourceNameQuery?: string; page: number; pageSize: number }
    ): Promise<DocumentListResponse> => {
      try {
        const { sourceNameQuery, page, pageSize } = payload
        const res = await documentsStore.listDocuments({ sourceNameQuery, page, pageSize })
        return res
      } catch (error) {
        console.error('❌ [LIST-DOCUMENTS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'list-chunks',
    async (
      _event,
      payload: { query?: string; page: number; pageSize: number }
    ): Promise<ChunkListResponse> => {
      try {
        const { query, page, pageSize } = payload
        const res = await documentsStore.listChunks({ query, page, pageSize })
        const normalized = res.items.map(normalizeForIpc)
        return { items: normalized, total: res.total }
      } catch (error) {
        console.error('❌ [LIST-CHUNKS] ERROR:', error)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle('drop-documents-table', async () => {
    try {
      const result = await documentsStore.dropDocumentsStorage()
      console.log('🗑️ [DROP-DOCUMENTS] DONE:', result)
      return { success: true, existed: result.existed }
    } catch (error) {
      console.error('❌ [DROP-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('delete-documents', async (event, ids: string[]) => {
    try {
      console.log('🗑️ [DELETE-DOCUMENTS] REQUEST:', ids)
      const res = await documentsStore.deleteDocumentsByIds(ids || [])
      console.log('🗑️ [DELETE-DOCUMENTS] DONE:', res)
      emitSourceListRefresh(event.sender)
      return res
    } catch (error) {
      console.error('❌ [DELETE-DOCUMENTS] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }
      const buffer = fs.readFileSync(filePath)
      return buffer
    } catch (error) {
      console.error('❌ [READ-FILE] ERROR:', error)
      throw error
    }
  })

  ipcMain.handle('download-model', async (event, repoId: string) => {
    try {
      const result = await modelService.downloadModel(repoId, (payload) => {
        event.sender.send('download-progress', payload)
      })
      // After successful download, re-initialize embedding service
      await embeddingService.initialize()
      return result
    } catch (error) {
      console.error('❌ [DOWNLOAD-MODEL] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('get-models', async () => {
    try {
      return modelService.getModels()
    } catch (error) {
      console.error('❌ [GET-MODELS] ERROR:', error)
      return []
    }
  })

  ipcMain.handle('get-embedding-status', () => {
    return embeddingService.getStatus()
  })

  ipcMain.handle(
    'ai-run-start',
    async (event, payload: AiRunStartRequest): Promise<AiRunStartResponse> => {
      const sessionId = String(payload?.sessionId || '').trim()
      const input = String(payload?.input || '').trim()
      const modelName = payload?.modelName ? String(payload.modelName).trim() : undefined
      const selectedReferences = normalizeSelectedReferences(payload?.selectedReferences)
      const workspace =
        payload?.workspace &&
        String(payload.workspace.workspaceId || '').trim() &&
        String(payload.workspace.workspaceName || '').trim() &&
        String(payload.workspace.rootPath || '').trim()
          ? {
              workspaceId: String(payload.workspace.workspaceId).trim(),
              workspaceName: String(payload.workspace.workspaceName).trim(),
              rootPath: String(payload.workspace.rootPath).trim(),
              policyProfile: payload.workspace.policyProfile
                ? String(payload.workspace.policyProfile)
                : undefined
            }
          : undefined
      const e2eFixtureScenario = isE2EFixtureModeEnabled() ? matchE2EChatScenario(input) : null
      if (!sessionId) return { success: false, error: 'sessionId is required' }
      if (!input) return { success: false, error: 'input is required' }

      const runId = uuidv4()
      activeAiRuns.set(runId, {
        cancelled: false,
        senderId: event.sender.id,
        abortController: new AbortController()
      })

      const sendEvent = (evt: AiRunEvent) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('ai-run-event', evt)
      }

      if (!e2eFixtureScenario) {
        const validation = await validateSelectedReferencesForRun({
          references: selectedReferences,
          workspaceStore,
          webSourceStore,
          sendEvent,
          runId
        })
        if (!validation.ok) {
          activeAiApprovals.delete(runId)
          activeAiRuns.delete(runId)
          return { success: false, error: validation.error }
        }
      }

      sendEvent({ type: 'run_started', runId, sessionId, createdAt: Date.now(), input })
      emitThinkingStarted({ sendEvent, runId })
      docxApplyService.beginRun({
        runId,
        sessionId,
        inputText: input
      })
      ;(async () => {
        try {
          const handledByE2EFixture = await maybeHandleE2EFixtureRun({
            runId,
            inputText: input,
            workspace,
            sendEvent,
            docxApplyService
          })
          if (handledByE2EFixture) {
            return
          }

          const runtimeSettings = await aiRuntimeSettingsStore.get()
          const result = await AiRunService.getInstance().run(
            {
              runId,
              sessionId,
              input,
              selectedReferences,
              modelName,
              workspace
            },
            {
              runtimeSettings,
              llmStore,
              chatStore,
              documentsStore,
              embeddingService,
              ensureEmbeddingReady: async () => {
                await ensureEmbeddingReady({
                  embeddingService,
                  modelService
                })
              },
              docxApplyService,
              isCancelled: () => Boolean(activeAiRuns.get(runId)?.cancelled),
              abortSignal: activeAiRuns.get(runId)?.abortController.signal,
              sendEvent,
              recordLlmIo: services.recordLlmIo,
              requestApprovalBatch: async (request) => {
                if (activeAiRuns.get(runId)?.cancelled) {
                  return { accepted: false, error: 'run not active' }
                }
                if (activeAiApprovals.has(runId)) {
                  return { accepted: false, error: 'approval batch already pending' }
                }

                sendEvent({
                  type: 'approval_batch_required',
                  runId,
                  taskId: request.taskId,
                  batchId: request.batchId,
                  items: request.items,
                  createdAt: Date.now(),
                  internal: request.internal,
                  stage: request.stage
                })

                return await new Promise<
                  | {
                      accepted: true
                      decisions: Array<{
                        itemId: string
                        action: 'approve' | 'reject' | 'guide'
                        message?: string
                      }>
                    }
                  | { accepted: false; error: string }
                >((resolve) => {
                  activeAiApprovals.set(runId, {
                    batchId: request.batchId,
                    taskId: request.taskId,
                    itemIds: request.items.map((item) => item.itemId),
                    resolve: (result) => {
                      activeAiApprovals.delete(runId)
                      sendEvent({
                        type: 'approval_batch_decision',
                        runId,
                        taskId: request.taskId,
                        batchId: request.batchId,
                        decisions: result.accepted
                          ? result.decisions
                          : request.items.map((item) => ({
                              itemId: item.itemId,
                              action: 'reject' as const,
                              message: result.error
                            })),
                        decidedAt: Date.now(),
                        internal: request.internal,
                        stage: request.stage
                      })
                      resolve(result)
                    }
                  })
                })
              }
            }
          )

          if (result.status === 'cancelled') {
            docxApplyService.discardRun(runId)
            sendEvent({ type: 'run_cancelled', runId })
            return
          }

          if (result.status === 'failed') {
            docxApplyService.discardRun(runId)
            sendEvent({
              type: 'run_failed',
              runId,
              error: result.error || 'failed',
              code: result.failureCode,
              resumeSnapshotSaved: result.resumeSnapshotSaved
            })
            return
          }

          try {
            await updateConversationMemoryAfterRun({
              runId,
              sessionId,
              userInput: input,
              assistantOutput: result.finalDeliveryMarkdown || '',
              artifacts: result.finalArtifacts || [],
              runtimeSettings,
              modelName: modelName || '',
              chatStore,
              llmStore,
              sendEvent,
              recordLlmIo: services.recordLlmIo,
              abortSignal: activeAiRuns.get(runId)?.abortController.signal
            })
          } catch (e) {
            void e
          }

          sendEvent({ type: 'run_completed', runId })
        } catch (e: unknown) {
          docxApplyService.discardRun(runId)
          if (activeAiRuns.get(runId)?.cancelled) {
            sendEvent({ type: 'run_cancelled', runId })
            return
          }
          const msg = e instanceof Error ? getErrorMessage(e) : String(e)
          sendEvent({ type: 'run_failed', runId, error: msg, code: 'error' })
        } finally {
          await releaseDocxRunSession(runId)
          const approval = activeAiApprovals.get(runId)
          approval?.resolve({ accepted: false, error: 'run closed' })
          activeAiApprovals.delete(runId)
          activeAiRuns.delete(runId)
        }
      })()

      return { success: true, runId }
    }
  )

  ipcMain.handle('ai-run-cancel', async (_event, runId: string): Promise<AiRunCancelResponse> => {
    const entry = activeAiRuns.get(String(runId || ''))
    if (!entry) return { success: false, error: 'run not found' }
    entry.cancelled = true
    entry.abortController.abort()
    return { success: true }
  })

  ipcMain.handle('ai-context-usage-get', async (_event, payload?: { sessionId?: string }) => {
    try {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId) return { success: false, error: 'sessionId is required' }
      const usage = await getAiContextUsage({ sessionId, chatStore })
      return { success: true, ...usage }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'ai-run-approval-batch-decide',
    async (
      _event,
      payload: AiRunApprovalBatchDecisionRequest
    ): Promise<AiRunApprovalBatchDecisionResponse> => {
      const runId = String(payload?.runId || '').trim()
      const batchId = String(payload?.batchId || '').trim()
      if (!runId || !batchId) {
        return { success: false, error: 'runId and batchId are required' }
      }

      const pending = activeAiApprovals.get(runId)
      if (!pending) return { success: false, error: 'run not found' }
      if (pending.batchId !== batchId) return { success: false, error: 'approval batch not found' }

      const decisions = Array.isArray(payload?.decisions) ? payload.decisions : []
      if (decisions.length !== pending.itemIds.length) {
        return { success: false, error: 'each approval item must have exactly one decision' }
      }

      const seenIds = new Set<string>()
      for (const decision of decisions) {
        const itemId = String(decision?.itemId || '').trim()
        const action = String(decision?.action || '').trim()
        if (!itemId || !pending.itemIds.includes(itemId) || seenIds.has(itemId)) {
          return { success: false, error: 'invalid approval decision items' }
        }
        if (action !== 'approve' && action !== 'reject' && action !== 'guide') {
          return { success: false, error: 'invalid approval decision action' }
        }
        if (action === 'guide') {
          const message = String(decision?.message || '').trim()
          if (!message) {
            return { success: false, error: 'guide decision requires non-empty message' }
          }
        }
        seenIds.add(itemId)
      }

      pending.resolve({
        accepted: true,
        decisions: decisions.map((decision) => ({
          itemId: String(decision.itemId).trim(),
          action: decision.action,
          message: typeof decision.message === 'string' ? decision.message.trim() : undefined
        }))
      })

      return { success: true }
    }
  )

  ipcMain.handle(
    'docx-apply-list',
    async (
      _event,
      payload?: ListDocxApplyRecordsRequest
    ): Promise<ListDocxApplyRecordsResponse> => {
      try {
        return await docxApplyService.listRecords(payload)
      } catch (e: unknown) {
        console.error('[DOCX-APPLY-LIST] Error:', e)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'docx-apply-get',
    async (_event, payload: GetDocxApplyRecordRequest): Promise<GetDocxApplyRecordResponse> => {
      try {
        return await docxApplyService.getRecord(payload)
      } catch (e: unknown) {
        console.error('[DOCX-APPLY-GET] Error:', e)
        return { error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'docx-apply-revert',
    async (_event, payload: RevertDocxApplyRequest): Promise<RevertDocxApplyResponse> => {
      try {
        return await docxApplyService.revertRecord(payload)
      } catch (e: unknown) {
        console.error('[DOCX-APPLY-REVERT] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  // === Chat & LLM Handlers ===

  ipcMain.handle('chat-session-list', async () => {
    try {
      return await chatStore.getChatSessions()
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-session-save', async (_event, session: ChatSession) => {
    try {
      await chatStore.saveChatSession(session)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-session-delete', async (_event, id: string) => {
    try {
      await chatStore.deleteChatSession(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-message-list', async (_event, sessionId: string) => {
    try {
      return await chatStore.getChatMessages(sessionId)
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('chat-message-save', async (_event, message: ChatMessage) => {
    try {
      await chatStore.saveChatMessage(message)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-list', async () => {
    try {
      return await llmStore.list()
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle('llm-config-save', async (_event, config: LLMConfig) => {
    try {
      await llmStore.save(config)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-delete', async (_event, id: string) => {
    try {
      await llmStore.delete(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('llm-config-set-active', async (_event, id: string) => {
    try {
      await llmStore.setActive(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[LLM-CONFIG-SET-ACTIVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle(
    'llm-config-model-list',
    async (_event, id: string): Promise<LlmModelListResponse> => {
      try {
        const config = await llmStore.getById(String(id || '').trim())
        if (!config) return { success: false, items: [], error: '配置不存在' }
        return await fetchLlmRemoteModels(config)
      } catch (e: unknown) {
        console.error('[LLM-CONFIG-MODEL-LIST] Error:', e)
        return { success: false, items: [], error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle('ai-runtime-settings-get', async () => {
    try {
      return await aiRuntimeSettingsStore.get()
    } catch (e: unknown) {
      console.error('[AI-RUNTIME-SETTINGS-GET] Error:', e)
      return {
        llmStreamingMode: 'force_stream'
      }
    }
  })

  ipcMain.handle('ai-runtime-settings-save', async (_event, settings: AiRuntimeSettings) => {
    try {
      await aiRuntimeSettingsStore.save(settings)
      return { success: true }
    } catch (e: unknown) {
      console.error('[AI-RUNTIME-SETTINGS-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })
}
