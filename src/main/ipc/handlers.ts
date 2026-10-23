import { UserSkillService } from '../services/skills/UserSkillService'
import type { UserSkillCreateRequest, UserSkillSetEnabledRequest } from '../../shared/userSkills'
import { AppSettingsError } from '../../shared/appErrors'
import { mainText } from '../services/app/i18n'
import { getAppRuntime, setServiceRoute } from '../services/app/AppRuntime'
import { FileReviewService } from '../services/ai/fileChanges/FileReviewService'
import { isWpsApplication, type OpenFileReviewLocationRequest } from '../../shared/fileReview'
import { notifyWpsFileOpened } from '../services/wps/officeFileWriteNotify'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { SystemNotificationService } from '../services/SystemNotificationService'
import type { TelemetryService } from '../services/telemetry/TelemetryService'
import type { AppErrorLogService } from '../services/logging/AppErrorLogService'
import type { OpenDialogOptions } from 'electron'
import { IngestionService } from '../services/ingestion/loader'
import { EmbeddingService } from '../services/vector/EmbeddingService'
import type { EmbeddingModelService } from '../services/vector/EmbeddingModelService'
import type { RemoteEmbeddingModelInput } from '../../shared/embeddingModels'
import { ensureEmbeddingReady } from '../services/vector/ensureEmbeddingReady'
import { StorageService } from '../services/storage/StorageService'
import { ModelService } from '../services/model/ModelService'
import { VectorModelDownloadService } from '../services/model/VectorModelDownloadService'
import { fetchLlmRemoteModels } from '../services/llm/modelCatalog'
import { FreeModelCatalogService } from '../services/llm/FreeModelCatalogService'
import { PresetModelCatalogService } from '../services/llm/PresetModelCatalogService'
import { validateLlmConfigForSave } from '../services/llm/configGuard'
import { AttachmentService } from '../services/attachments/AttachmentService'
import { isModelSource } from '../../shared/modelSources'
import { emptyPresetModelsSnapshot } from '../../shared/llmPresets'
import { ChatRunService } from '../services/ai/ChatRunService'
import { PartnerCacheService } from '../services/assets/PartnerCacheService'
import type { PartnerCacheRequest, PartnerCacheOpenRequest } from '../../shared/partnerCache'
import { terminalSessionManager } from '../services/ai/human/tools/terminal/TerminalSessionManager'
import { ScheduledTaskService } from '../services/scheduler/ScheduledTaskService'
import { AiRunResourceManager } from '../services/ai/run/AiRunResourceManager'
import { AiFileChangeService } from '../services/ai/fileChanges/AiFileChangeService'
import { getAiContextUsage } from '../services/ai/contextUsage'
import { lookupCatalogModelContextTokens } from '../services/ai/modelContextWindow'
import { DocxApplyService } from '../services/ai/human/tools/docx/review/DocxApplyService'
import { releaseDocxRunSession } from '../services/ai/human/tools/docx/worker/docxWorkerClient'
import { releasePdfRunSession } from '../services/pdf/worker/pdfWorkerClient'
import { createEmptyPartnerUiState } from '../services/storage/domains/WorkbenchUiStore'
import type {
  AiLlmIoRecord,
  FileWatchCheckResponse,
  FileWatchMutationRequest,
  FileWatchStartRequest,
  FileWatchStartResponse,
  FileWatchStopResponse,
  ScheduledTaskMutationResponse,
  ScheduledTaskSaveRequest,
  ScheduledTaskSetEnabledRequest,
  ScheduledTaskRunNowRequest,
  ScheduledTaskDismissBusyNoticeRequest,
  WriteTextFileRequest,
  WriteTextFileResponse,
  WorkspaceFileCreateRequest,
  WorkspaceFileRenameRequest,
  WorkspaceFileEntryResponse,
  WorkspaceFileTrashRequest,
  WorkspaceFileMutationResponse,
  AiRunHumanInteractionRequest,
  AiRunHumanInteractionResponse
} from '../../shared/types'
import { listReferenceItemsPage } from '../services/sourceScope/referenceList'
import { WorkspaceSourceService } from '../services/workspace/WorkspaceSourceService'
import { WorkspaceFileService } from '../services/workspace/WorkspaceFileService'
import { WorkspaceKnowledgePrepareService } from '../services/workspace/WorkspaceKnowledgePrepareService'
import {
  IndexPrepareCancelledError,
  isIndexPrepareCancelledError,
  resolveCancelledPrepareJobStatus,
  toFilePreparePreviousSnapshot,
  toWebPreparePreviousSnapshot,
  WorkspaceIndexPrepareController
} from '../services/workspace/WorkspaceIndexPrepareController'
import { createWorkspaceKnowledgeCache } from '../services/workspace/WorkspaceKnowledgeCache'
import { WebSourceService } from '../services/web/WebSourceService'
import { OpenWithService } from '../services/openWith/OpenWithService'
import { FileWatchService } from '../services/files/FileWatchService'
import type { BrowserEmbedService } from '../services/browser/BrowserEmbedService'
import type { WebCrawlerService } from '../services/webCrawler/types'
import { v4 as uuidv4 } from 'uuid'
import type {
  Partner,
  PartnerListItem,
  PartnerCreateRequest,
  PartnerCreateResponse,
  PartnerUpdateRequest,
  PartnerUpdateResponse,
  PartnerClearContextRequest,
  PartnerClearContextResponse,
  PartnerSetPinnedRequest,
  PartnerSnapshotRequest,
  PartnerSnapshotResponse,
  PartnerOpenRequest,
  PartnerOpenResponse,
  PartnerUiStateSaveRequest,
  PartnerUiStateSaveResponse,
  PartnerRunSummariesRequest,
  PartnerRunSummariesResponse,
  ChatSubmitRequest,
  ChatSubmitResponse,
  ChatTurnRetractLatestRequest,
  ChatTurnRetractLatestResponse,
  AttachmentPickRequest,
  AttachmentPickResponse,
  AttachmentCreateFromPathRequest,
  AttachmentProcessResponse,
  AttachmentSaveRequest,
  AppSettings,
  LLMConfig,
  LlmModelListResponse,
  AiRunCancelResponse,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  BrowserPanelBoundsRequest,
  BrowserPanelFollowRequest,
  BrowserPanelCaptureResponse,
  BrowserPanelHideRequest,
  BrowserPanelMenuRequest,
  BrowserPanelMutationResponse,
  BrowserPanelPresentationResponse,
  BrowserPanelShowRequest,
  BrowserPanelStateResponse,
  BrowserResourceMenuRequest,
  BrowserTabCreateRequest,
  BrowserTabCreateResponse,
  BrowserTabListRequest,
  BrowserTabListResponse,
  WorkbenchUiStateResponse,
  WorkbenchUiStateSaveRequest,
  BrowserTabMutationRequest,
  BrowserTabNavigateRequest,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse,
  RevertAiFileChangeRequest,
  RevertAiFileChangeResponse,
  CreateWorkspaceSourceRequest,
  DeleteWorkspaceSourceResponse,
  ListReferenceItemsRequest,
  ListWorkspaceTreeRequest,
  ListWorkspaceDirectoryRequest,
  WorkspaceDirectoryListResponse,
  ListOpenWithApplicationsRequest,
  ListOpenWithApplicationsResponse,
  OpenFileWithApplicationRequest,
  OpenFileWithApplicationResponse,
  PickDirectoryResponse,
  PickFileResponse,
  ReferenceItemListResponse,
  SetWorkspaceRootPathRequest,
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
  WorkspaceTreeEntry,
  WorkspaceTreeListResponse,
  WorkspaceSource,
  WorkspaceListResponse,
  WorkspaceIndexCancelRequest,
  WorkspaceIndexPrepareSessionBeginRequest
} from '../types/store'
import path from 'path'
import fs from 'fs'
import { WEB_INGEST_CONCURRENCY } from '../utils/constant'
import { writeTextFileAtomically } from '../services/files/TextFileWriteService'
import { ConfirmDialogWindowService } from '../services/ConfirmDialogWindowService'
import type { ConfirmDialogRequest, ConfirmDialogResponse } from '../../shared/types'

const WEB_INDEX_OWNER = '__web__'

type E2ENativeDialogSelection = {
  kind: 'directory' | 'file'
  path: string
}

type E2ENativeDialogGlobal = typeof globalThis & {
  __NCURATOR_E2E_NATIVE_DIALOG_SELECTIONS__?: Map<number, E2ENativeDialogSelection>
}

const e2eNativeDialogSelections =
  process.env.NCURATOR_E2E_OBSERVER === '1' ? new Map<number, E2ENativeDialogSelection>() : null

if (e2eNativeDialogSelections) {
  ;(globalThis as E2ENativeDialogGlobal).__NCURATOR_E2E_NATIVE_DIALOG_SELECTIONS__ =
    e2eNativeDialogSelections
}

const takeE2ENativeDialogSelection = (
  webContentsId: number,
  expectedKind?: E2ENativeDialogSelection['kind']
): string | null => {
  const selection = e2eNativeDialogSelections?.get(webContentsId)
  if (!selection || (expectedKind && selection.kind !== expectedKind)) return null
  e2eNativeDialogSelections?.delete(webContentsId)
  const selectedPath = path.resolve(selection.path)
  if (!fs.existsSync(selectedPath)) {
    throw new Error(`E2E native dialog path does not exist: ${selectedPath}`)
  }
  const stats = fs.statSync(selectedPath)
  const actualKind: E2ENativeDialogSelection['kind'] = stats.isDirectory() ? 'directory' : 'file'
  if (selection.kind !== actualKind) {
    throw new Error(`E2E native dialog path has the wrong type: ${selectedPath}`)
  }
  if (expectedKind && actualKind !== expectedKind) {
    throw new Error(`E2E native dialog path has the wrong type: ${selectedPath}`)
  }
  return selectedPath
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

export function registerOpenExternalHandler(): void {
  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(String(url))
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: '仅支持 http/https URL' }
      }
      await shell.openExternal(parsed.toString())
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}

export function registerHandlers(services: {
  ingestionService: IngestionService
  embeddingService: EmbeddingService
  embeddingModelService?: EmbeddingModelService
  storageService: StorageService
  modelService: ModelService
  vectorModelDownloadService: VectorModelDownloadService
  browserEmbedService?: BrowserEmbedService
  webCrawlerService?: WebCrawlerService
  recordLlmIo?: (record: AiLlmIoRecord) => void
  systemNotificationService?: SystemNotificationService
  telemetryService?: TelemetryService
  errorLogService?: AppErrorLogService
}) {
  const useE2ENoopOpenWith =
    process.env.NCURATOR_E2E_OBSERVER === '1' && process.env.NCURATOR_E2E_OPEN_WITH_NOOP === '1'
  const openWithService = new OpenWithService({
    ...(useE2ENoopOpenWith ? { runNativeOpen: async () => ({ success: true }) } : {}),
    preferences: services.storageService.openWithPreferences,
    onPreferenceChanged: (extension) =>
      BrowserWindow.getAllWindows().forEach((window) =>
        window.webContents.send('open-with-preference-changed', extension)
      )
  })
  const fileWatchService = new FileWatchService()
  const confirmDialogService = new ConfirmDialogWindowService()
  ipcMain.handle(
    'confirm-dialog-show',
    async (event, request: ConfirmDialogRequest): Promise<ConfirmDialogResponse> => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner || owner.webContents !== event.sender) {
        return { success: false, error: '无法找到确认弹窗所属窗口' }
      }
      try {
        return await confirmDialogService.show(owner, request)
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
  ipcMain.handle('confirm-dialog-close', (event, dialogId: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (owner && owner.webContents === event.sender) confirmDialogService.close(owner, dialogId)
  })
  const fileWatchOwners = new Set<number>()
  const {
    embeddingService,
    storageService,
    modelService,
    vectorModelDownloadService,
    browserEmbedService,
    webCrawlerService,
    telemetryService,
    errorLogService
  } = services
  const activeWorkspaceIndexJobs = new Set<string>()
  const documentsStore = storageService.documents
  const partnerStore = storageService.partner
  const workbenchUiStore = storageService.workbenchUi
  const chatMessageLogStore = storageService.chatMessageLog
  const aiRunStore = storageService.aiRun
  const llmStore = storageService.llm
  const appSettingsStore = storageService.appSettings
  const webSourceStore = storageService.webSource
  const workspaceStore = storageService.workspace
  const workspaceIndexJobStore = storageService.workspaceIndexJob
  const prepareController = new WorkspaceIndexPrepareController({
    workspaceStore,
    webSourceStore
  })
  const aiFileChangeService = new AiFileChangeService(storageService.aiFileChange)
  const fileReviewService = new FileReviewService(aiFileChangeService, openWithService)
  ipcMain.handle('file-review-get', (_event, request: { changeRecordId: string }) =>
    fileReviewService.read(request.changeRecordId)
  )
  ipcMain.handle('file-review-open-location', (_event, request: OpenFileReviewLocationRequest) =>
    fileReviewService.openLocation(request)
  )
  ipcMain.handle(
    'open-with-set-preferred',
    (_event, request: { filePath: string; applicationId: string | null }) =>
      openWithService.setPreferred(request.filePath, request.applicationId)
  )
  const docxApplyService = new DocxApplyService(aiFileChangeService)
  const attachmentService = new AttachmentService()
  const runResourceManager = new AiRunResourceManager([
    { id: 'docx', releaseRun: releaseDocxRunSession },
    { id: 'pdf', releaseRun: releasePdfRunSession },
    {
      id: 'browser',
      releaseRun: (runId) => browserEmbedService?.releaseRun(runId) ?? Promise.resolve()
    }
  ])
  const e2eGraphRecursionLimitOnce = (() => {
    if (process.env.NCURATOR_E2E_OBSERVER !== '1') return undefined
    const value = Number(process.env.NCURATOR_E2E_HUMAN_GRAPH_RECURSION_LIMIT_ONCE)
    return Number.isInteger(value) && value > 0 ? value : undefined
  })()
  let e2eGraphRecursionLimitUsesRemaining = e2eGraphRecursionLimitOnce ? 1 : 0
  const scheduledTaskServiceRef: { current?: ScheduledTaskService } = {}
  const partnerCacheService = new PartnerCacheService({
    partners: partnerStore,
    ui: workbenchUiStore,
    fileChanges: storageService.aiFileChange,
    isPartnerBusy: (partnerId) => chatRunService.hasActivePartnerRun(partnerId),
    beforeCleanup: (partnerId) => terminalSessionManager.closeByChatSession(partnerId)
  })
  const userSkillService = new UserSkillService(storageService.userSkill)
  const chatRunService = new ChatRunService({
    userSkillService,
    partnerStore,
    partnerCacheService,
    chatMessageLogStore,
    subagentStore: storageService.subagent,
    aiRunStore,
    documentsStore,
    embeddingService,
    llmStore,
    workspaceStore,
    workspaceIndexJobStore,
    webSourceStore,
    ensureEmbeddingReady: async () => {
      await ensureEmbeddingReady({
        embeddingService,
        modelService
      })
    },
    docxApplyService,
    aiFileChangeService,
    runResourceManager,
    browserUseService: browserEmbedService,
    webCrawlerService,
    scheduledTaskService: () => scheduledTaskServiceRef.current,
    telemetryService,
    errorLogService,
    recordLlmIo: services.recordLlmIo,
    resolveHumanRuntimeOverrides: (run) => {
      const modelContextWindowTokens = lookupCatalogModelContextTokens(run.mainModel)
      if (!e2eGraphRecursionLimitOnce || e2eGraphRecursionLimitUsesRemaining <= 0) {
        return { modelContextWindowTokens }
      }
      e2eGraphRecursionLimitUsesRemaining -= 1
      return {
        modelContextWindowTokens,
        graphRecursionLimit: e2eGraphRecursionLimitOnce
      }
    },
    onRunTerminal: async (run, status) => {
      await services.systemNotificationService?.notifyRunTerminal(run, status)
    }
  })
  void chatRunService.failInterruptedRuns().catch((error) => {
    console.error('[CHAT-RUN] Failed to mark interrupted runs:', error)
  })
  const workspaceService = new WorkspaceSourceService()
  const workspaceFileService = new WorkspaceFileService()
  const workspaceKnowledgePrepareService = new WorkspaceKnowledgePrepareService({
    embeddingService,
    documentsStore,
    errorLogService
  })
  const webSourceService = new WebSourceService()

  const emitSessionListRefreshToAll = () => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('chat-session-list-refresh')
      }
    })
  }

  scheduledTaskServiceRef.current = new ScheduledTaskService({
    taskStore: storageService.scheduledTask,
    partnerStore,
    getPartnerUiState: (partnerId) => workbenchUiStore.getPartnerState(partnerId),
    hasActivePartnerRun: (partnerId) => chatRunService.hasActivePartnerRun(partnerId),
    submitTask: (payload) => chatRunService.submit(payload),
    emitSessionListRefresh: emitSessionListRefreshToAll
  })
  const scheduledTaskService = scheduledTaskServiceRef.current
  if (!scheduledTaskService) throw new Error('定时任务服务初始化失败')
  void scheduledTaskService.start()

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

  vectorModelDownloadService.onProgress((payload) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('download-progress', payload)
      }
    })
  })

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

  const hydrateWorkspaceListItem = async (
    workspace: WorkspaceSource
  ): Promise<WorkspaceListItem> => {
    const fileSummary = await workspaceStore.getWorkspaceFileSummary(workspace.id)
    let rootKind: WorkspaceListItem['root_kind'] = 'directory'
    try {
      const inspected = await workspaceService.normalizeWorkspaceRoot(workspace.root_path)
      rootKind = inspected.kind
    } catch {
      rootKind = 'directory'
    }
    return {
      ...workspace,
      file_count: fileSummary.file_count,
      web_count: 0,
      root_kind: rootKind
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
      if (!currentWorkspace.root_path) throw new Error('workspace rootPath is required')

      const existingRecords = await workspaceStore.listWorkspaceFileIndexRecords(workspaceId)
      const now = Date.now()
      let lastReportedScanEntryCount = 0
      const scanResult = await workspaceService.scanWorkspaceTree({
        workspaceId,
        rootPath: currentWorkspace.root_path,
        now,
        onProgress: async ({ scannedEntryCount, supportedFileCount }) => {
          if (scannedEntryCount - lastReportedScanEntryCount < 20) return
          lastReportedScanEntryCount = scannedEntryCount
          job = await updateAndEmitWorkspaceIndexJob(job, {
            phase: 'scan',
            step_index: 1,
            step_total: 2,
            total_count: 0,
            processed_count: scannedEntryCount,
            failed_count: 0,
            message: `已扫描 ${scannedEntryCount} 项，发现 ${supportedFileCount} 个可索引文件`,
            updated_at: Date.now()
          })
        }
      })
      const supportedFileCount = scanResult.entries.filter(
        (entry) => entry.kind === 'file' && entry.supported_for_index
      ).length
      job = await updateAndEmitWorkspaceIndexJob(job, {
        phase: 'diff',
        step_index: 2,
        step_total: 2,
        total_count: supportedFileCount,
        processed_count: 0,
        failed_count: 0,
        message: `正在比对索引 0/${supportedFileCount}`,
        updated_at: Date.now()
      })
      let lastReportedDiffCount = 0
      const diff = await workspaceService.diffWorkspaceTreeAgainstIndex({
        entries: scanResult.entries,
        records: existingRecords,
        onProgress: async ({ processedCount, totalCount }) => {
          if (processedCount - lastReportedDiffCount < 10 && processedCount !== totalCount) return
          lastReportedDiffCount = processedCount
          job = await updateAndEmitWorkspaceIndexJob(job, {
            phase: 'diff',
            step_index: 2,
            step_total: 2,
            total_count: totalCount,
            processed_count: processedCount,
            failed_count: 0,
            message: `正在比对索引 ${processedCount}/${totalCount}`,
            updated_at: Date.now()
          })
        }
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
      if (prepareController.isCancelled('file')) {
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'cancelled',
          phase: 'complete',
          message: '已停止更新索引',
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }
      const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
      if (!currentWorkspace) throw new Error('workspace not found')
      if (!currentWorkspace.root_path) throw new Error('请先设置工作目录')

      const prepareStartedAt = Date.now()
      const { targets, recordMap, added, updated, removed } = await collectFilePrepareTargets({
        workspaceId,
        workspace: currentWorkspace,
        now: prepareStartedAt
      })
      if (prepareController.isCancelled('file')) {
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'cancelled',
          phase: 'complete',
          total_count: targets.length,
          target_ids: targets.map((record) => record.id),
          message: '已停止更新索引',
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }
      job = await updateAndEmitWorkspaceIndexJob(job, {
        total_count: targets.length,
        target_ids: targets.map((record) => record.id),
        message: `准备更新 ${targets.length} 个文件`,
        updated_at: Date.now()
      })
      if (targets.length > 0) {
        await workspaceStore.upsertWorkspaceFileIndexRecords(
          targets.map((record) => ({
            ...record,
            last_checked_at: prepareStartedAt,
            updated_at: prepareStartedAt
          }))
        )
      }

      let processed = 0
      let failed = 0
      let cancelled = false
      const knowledgeCache = createWorkspaceKnowledgeCache()
      for (const target of targets) {
        if (prepareController.isCancelled('file')) {
          cancelled = true
          break
        }
        const currentRecord = recordMap.get(target.relative_path) || target
        prepareController.rememberFilePrevious(
          currentRecord.id,
          toFilePreparePreviousSnapshot(currentRecord)
        )
        const documentId = currentRecord.document_id || uuidv4()
        await workspaceStore.upsertWorkspaceFileIndexRecords([
          {
            ...currentRecord,
            index_status: 'indexing',
            last_checked_at: prepareStartedAt,
            updated_at: Date.now()
          }
        ])
        job = await updateAndEmitWorkspaceIndexJob(job, {
          message: `正在处理 ${processed + 1}/${targets.length}：${currentRecord.relative_path}`,
          updated_at: Date.now()
        })
        try {
          const indexedDocument = await workspaceKnowledgePrepareService.indexLocalFile({
            workspaceId,
            documentId,
            filePath: currentRecord.absolute_path,
            documentName: currentRecord.name,
            cache: knowledgeCache || undefined,
            signal: prepareController.getSignal('file')
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
          if (prepareController.isCancelled('file')) cancelled = true
        } catch (error) {
          if (isIndexPrepareCancelledError(error)) {
            cancelled = true
            break
          }
          failed += 1
          errorLogService?.write({
            module: 'workspace-index',
            error: error instanceof Error ? error : String(error),
            context: {
              phase: 'file-index',
              file: currentRecord.relative_path,
              extension: currentRecord.file_ext
            }
          })
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
          if (prepareController.isCancelled('file')) cancelled = true
        }
        processed += 1
        job = await updateAndEmitWorkspaceIndexJob(job, {
          processed_count: processed,
          failed_count: failed,
          message: `已处理 ${processed}/${targets.length}`,
          updated_at: Date.now()
        })
        if (cancelled) break
      }

      if (cancelled || prepareController.isCancelled('file')) {
        const unfinishedCount = await prepareController.revertUnfinishedFiles()
        const status = resolveCancelledPrepareJobStatus({
          unfinishedCount,
          processedCount: processed,
          totalCount: targets.length,
          failedCount: failed
        })
        await updateAndEmitWorkspaceIndexJob(job, {
          status,
          phase: 'complete',
          processed_count: processed,
          failed_count: failed,
          message:
            status === 'cancelled'
              ? `已停止更新索引，完成 ${processed} 个`
              : failed > 0
                ? `索引完成，失败 ${failed} 个；新增 ${added}，变更 ${updated}，移除 ${removed}`
                : `索引完成；新增 ${added}，变更 ${updated}，移除 ${removed}`,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        await documentsStore.purgeStaleChunks()
        return
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
      await documentsStore.purgeStaleChunks()
    } catch (error) {
      if (isIndexPrepareCancelledError(error) || prepareController.isCancelled('file')) {
        const unfinishedCount = await prepareController.revertUnfinishedFiles()
        const status = resolveCancelledPrepareJobStatus({
          unfinishedCount,
          processedCount: job.processed_count,
          totalCount: job.total_count,
          failedCount: job.failed_count
        })
        await updateAndEmitWorkspaceIndexJob(job, {
          status,
          phase: 'complete',
          message: status === 'cancelled' ? '已停止更新索引' : job.message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        await documentsStore.purgeStaleChunks()
        return
      }
      const message = getErrorMessage(error)
      errorLogService?.write({
        module: 'workspace-index',
        error: error instanceof Error ? error : message,
        context: { phase: 'job', source: 'file' }
      })
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
      await documentsStore.purgeStaleChunks()
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'file'))
    }
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
      const rawUrl = String(document.source_url || document.file_path || document.name || '').trim()
      if (!rawUrl) continue
      try {
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
        const now = Date.now()
        if (existing) {
          await webSourceStore.updateWebSource(existing.id, {
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
        workspace_id: WEB_INDEX_OWNER
      })
      await documentsStore.markDocumentIndexing(existingDocument.id, now)
    } else {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        workspace_id: WEB_INDEX_OWNER,
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
      await documentsStore
        .markDocumentIndexFailed(nextDocumentId, getErrorMessage(error))
        .catch(() => {})
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
      const documentName = inspection.title?.trim() || source.url
      const indexed = await workspaceKnowledgePrepareService.indexWebText({
        sourceType: 'web',
        workspaceId: WEB_INDEX_OWNER,
        documentId: nextDocumentId,
        documentName,
        sourceUrl: source.url,
        rawText: inspection.text,
        contentHash: inspection.contentHash,
        cache: createWorkspaceKnowledgeCache() || undefined
      })

      const refreshedSource: WebSourceRecord = {
        ...crawlingDoneSource,
        title: indexed.documentName,
        index_status: 'indexed',
        fetched_at: Date.now(),
        last_indexed_at: Date.now(),
        last_error: undefined,
        updated_at: Date.now()
      }
      await webSourceStore.saveWebSource(refreshedSource)
      emitSourceListRefresh(event.sender)
      return { source: refreshedSource, chunkCount: indexed.chunkCount }
    } catch (error) {
      await documentsStore
        .markDocumentIndexFailed(nextDocumentId, getErrorMessage(error))
        .catch(() => {})
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
    if (!existingDocument) {
      await documentsStore.addDocument({
        id: nextDocumentId,
        name: source.title || source.url,
        source_type: 'web',
        workspace_id: WEB_INDEX_OWNER,
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
      if (prepareController.isCancelled('web')) {
        throw new IndexPrepareCancelledError()
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
      emitSourceListRefresh(sender)
      emitSourceListRefreshToAll()
      return { source: crawlingDoneSource, documentId: nextDocumentId, inspection }
    } catch (error) {
      if (isIndexPrepareCancelledError(error)) {
        throw new IndexPrepareCancelledError()
      }
      await documentsStore
        .markDocumentIndexFailed(nextDocumentId, getErrorMessage(error))
        .catch(() => {})
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
      const documentName = input.inspection.title?.trim() || input.source.url
      const indexed = await workspaceKnowledgePrepareService.indexWebText({
        sourceType: 'web',
        workspaceId: WEB_INDEX_OWNER,
        documentId: input.documentId,
        documentName,
        sourceUrl: input.source.url,
        rawText: input.inspection.text,
        contentHash: input.inspection.contentHash,
        cache: createWorkspaceKnowledgeCache() || undefined,
        signal: prepareController.getSignal('web')
      })
      const indexedAt = Date.now()
      const refreshedSource: WebSourceRecord = {
        ...input.source,
        title: indexed.documentName,
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
      if (isIndexPrepareCancelledError(error)) {
        throw new IndexPrepareCancelledError()
      }
      await documentsStore
        .markDocumentIndexFailed(input.documentId, getErrorMessage(error))
        .catch(() => {})
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
      const sources = await webSourceStore.listWebSources()
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
      if (prepareController.isCancelled('web')) {
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'cancelled',
          phase: 'complete',
          message: '已停止更新索引',
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }
      await ensureWebSourcesHydrated()
      const sources = await webSourceStore.listWebSources()
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
      if (prepareController.isCancelled('web')) {
        await updateAndEmitWorkspaceIndexJob(job, {
          status: 'cancelled',
          phase: 'complete',
          message: '已停止更新索引',
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        return
      }

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
          if (prepareController.isCancelled('web')) return
          const current = targets[crawlIndex++]
          if (!current) return
          prepareController.rememberWebPrevious(current.id, toWebPreparePreviousSnapshot(current))
          try {
            const crawled = await crawlWebSourceForIndexJob(input.sender, current)
            crawledSources.push(crawled)
          } catch (error) {
            if (isIndexPrepareCancelledError(error)) return
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
          if (prepareController.isCancelled('web')) return
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => runCrawlOne()))
      if (prepareController.isCancelled('web')) {
        const unfinishedCount = await prepareController.revertUnfinishedWebSources()
        const status = resolveCancelledPrepareJobStatus({
          unfinishedCount,
          processedCount: crawlProcessed,
          totalCount: targets.length,
          failedCount: crawlFailed
        })
        await updateAndEmitWorkspaceIndexJob(job, {
          status,
          phase: 'complete',
          total_count: targets.length,
          processed_count: crawlProcessed,
          failed_count: crawlFailed,
          message: status === 'cancelled' ? '已停止更新索引' : job.message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        await documentsStore.purgeStaleChunks()
        return
      }

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
          if (prepareController.isCancelled('web')) return
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
            if (isIndexPrepareCancelledError(error)) return
            void error
            indexFailed += 1
          }
          indexProcessed += 1
          if (prepareController.isCancelled('web')) return
          job = await updateAndEmitWorkspaceIndexJob(job, {
            processed_count: indexProcessed,
            failed_count: indexFailed,
            message: `步骤 2/2 建立索引：${indexProcessed}/${crawledSources.length}`,
            updated_at: Date.now()
          })
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => runIndexOne()))
      if (prepareController.isCancelled('web')) {
        const unfinishedCount = await prepareController.revertUnfinishedWebSources()
        const status = resolveCancelledPrepareJobStatus({
          unfinishedCount,
          processedCount: indexProcessed,
          totalCount: crawledSources.length,
          failedCount: crawlFailed + indexFailed
        })
        await updateAndEmitWorkspaceIndexJob(job, {
          status,
          phase: 'complete',
          total_count: targets.length,
          processed_count: crawlProcessed + indexProcessed,
          failed_count: crawlFailed + indexFailed,
          message: status === 'cancelled' ? '已停止更新索引' : job.message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        await documentsStore.purgeStaleChunks()
        return
      }

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
      await documentsStore.purgeStaleChunks()
    } catch (error) {
      if (isIndexPrepareCancelledError(error) || prepareController.isCancelled('web')) {
        const unfinishedCount = await prepareController.revertUnfinishedWebSources()
        const status = resolveCancelledPrepareJobStatus({
          unfinishedCount,
          processedCount: job.processed_count,
          totalCount: job.total_count,
          failedCount: job.failed_count
        })
        await updateAndEmitWorkspaceIndexJob(job, {
          status,
          phase: 'complete',
          message: status === 'cancelled' ? '已停止更新索引' : job.message,
          updated_at: Date.now(),
          finished_at: Date.now()
        })
        await documentsStore.purgeStaleChunks()
        return
      }
      const message = getErrorMessage(error)
      await updateAndEmitWorkspaceIndexJob(job, {
        status: 'failed',
        last_error: message,
        message,
        updated_at: Date.now(),
        finished_at: Date.now()
      })
      await documentsStore.purgeStaleChunks()
    } finally {
      activeWorkspaceIndexJobs.delete(getWorkspaceIndexJobKey(workspaceId, 'web'))
    }
  }

  ipcMain.handle(
    'ingest-web',
    async (
      event,
      payload: {
        url: string
        includeSelectors?: string[]
        excludeSelectors?: string[]
      }
    ) => {
      try {
        await ensureWebSourcesHydrated()
        const rawUrl = String(payload?.url || '').trim()
        if (!rawUrl) throw new Error('URL 不能为空')
        const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
        const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
        const source =
          existing ||
          webSourceService.createWebSource({
            url,
            normalizedUrl,
            includeSelectors: payload.includeSelectors,
            excludeSelectors: payload.excludeSelectors,
            indexStatus: 'needs_index'
          })
        const nextSource: WebSourceRecord = {
          ...source,
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
        console.error('? [INGEST-WEB] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'ingest-webs',
    async (
      event,
      payload: Array<{
        url: string
        includeSelectors?: string[]
        excludeSelectors?: string[]
      }>
    ) => {
      try {
        await ensureWebSourcesHydrated()
        const items = Array.isArray(payload) ? payload : []
        const preparedSources: WebSourceRecord[] = []

        for (const item of items) {
          const rawUrl = String(item?.url || '').trim()
          if (!rawUrl) continue
          const { url, normalizedUrl } = webSourceService.normalizeUrl(rawUrl)
          const existing = await webSourceStore.getWebSourceByNormalizedUrl(normalizedUrl)
          const source =
            existing ||
            webSourceService.createWebSource({
              url,
              normalizedUrl,
              includeSelectors: item.includeSelectors,
              excludeSelectors: item.excludeSelectors,
              indexStatus: 'needs_index'
            })
          const nextSource: WebSourceRecord = {
            ...source,
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
        console.error('? [INGEST-WEBS] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  registerOpenExternalHandler()

  ipcMain.handle(
    'file-watch-start',
    async (event, payload: FileWatchStartRequest): Promise<FileWatchStartResponse> => {
      try {
        const sender = event.sender
        fileWatchService.stopOwner(sender.id)
        if (!fileWatchOwners.has(sender.id)) {
          fileWatchOwners.add(sender.id)
          sender.once('destroyed', () => {
            fileWatchService.stopOwner(sender.id)
            fileWatchOwners.delete(sender.id)
          })
        }
        const result = await fileWatchService.start({
          ownerId: sender.id,
          filePath: payload?.filePath || '',
          onChange: (change) => {
            if (!sender.isDestroyed()) sender.send('file-watch-changed', change)
          }
        })
        return { success: true, ...result }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'file-watch-check',
    async (event, payload: FileWatchMutationRequest): Promise<FileWatchCheckResponse> => {
      try {
        const watchId = String(payload?.watchId || '').trim()
        if (!fileWatchService.isOwnedBy(watchId, event.sender.id)) {
          return { success: false, changed: false, error: 'file watch not found' }
        }
        return { success: true, changed: await fileWatchService.check(watchId) }
      } catch (error) {
        return { success: false, changed: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'file-watch-stop',
    async (event, payload: FileWatchMutationRequest): Promise<FileWatchStopResponse> => {
      const watchId = String(payload?.watchId || '').trim()
      if (!fileWatchService.isOwnedBy(watchId, event.sender.id)) {
        return { success: false, error: 'file watch not found' }
      }
      fileWatchService.stop(watchId)
      return { success: true }
    }
  )

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
    'list-open-with-applications',
    async (
      _event,
      payload: ListOpenWithApplicationsRequest
    ): Promise<ListOpenWithApplicationsResponse> => openWithService.list(payload?.filePath || '')
  )

  ipcMain.handle(
    'open-file-with-application',
    async (
      _event,
      payload: OpenFileWithApplicationRequest
    ): Promise<OpenFileWithApplicationResponse> => {
      const filePath = payload?.filePath || ''
      return openWithService.open(filePath, payload?.applicationId || '', (application) => {
        if (isWpsApplication(application)) notifyWpsFileOpened(filePath)
      })
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
      const e2eSelectedPath = takeE2ENativeDialogSelection(event.sender.id, 'directory')
      if (e2eSelectedPath) return { canceled: false, path: e2eSelectedPath }
      const dialogOptions: OpenDialogOptions = {
        title: mainText('selectWorkspaceDirectory'),
        buttonLabel: mainText('chooseDirectory'),
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

  ipcMain.handle('pick-file', async (event, defaultPath?: string): Promise<PickFileResponse> => {
    try {
      const e2eSelectedPath = takeE2ENativeDialogSelection(event.sender.id, 'file')
      if (e2eSelectedPath) return { canceled: false, path: e2eSelectedPath }
      const dialogOptions: OpenDialogOptions = {
        title: mainText('openFile'),
        buttonLabel: mainText('open'),
        defaultPath: String(defaultPath || '').trim() || undefined,
        properties: ['openFile', 'dontAddToRecent']
      }
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      return { canceled: false, path: result.filePaths[0] }
    } catch (error) {
      return { canceled: true, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'attachment-pick',
    async (event, payload: AttachmentPickRequest): Promise<AttachmentPickResponse> => {
      try {
        const partnerId = String(payload?.partnerId || '').trim()
        const assetBucketId = String(payload?.assetBucketId || '').trim()
        if (!partnerId) {
          return { canceled: true, items: [], error: '请先选择伙伴' }
        }
        if (!assetBucketId) {
          return { canceled: true, items: [], error: '附件目录不存在，无法保存附件' }
        }
        const dialogOptions: OpenDialogOptions = {
          title: mainText('addAttachments'),
          buttonLabel: mainText('choose'),
          properties: ['openFile', 'openDirectory', 'multiSelections', 'dontAddToRecent']
        }
        const ownerWindow = BrowserWindow.fromWebContents(event.sender)
        const e2eSelectedPath = takeE2ENativeDialogSelection(event.sender.id)
        const filePaths = e2eSelectedPath
          ? [e2eSelectedPath]
          : (
              await (ownerWindow
                ? dialog.showOpenDialog(ownerWindow, dialogOptions)
                : dialog.showOpenDialog(dialogOptions))
            ).filePaths
        if (filePaths.length === 0) return { canceled: true, items: [] }
        return {
          canceled: false,
          items: await Promise.all(
            filePaths.map(
              async (filePath) =>
                await attachmentService.createSourceAttachmentFromPath({ sourcePath: filePath })
            )
          )
        }
      } catch (error) {
        return { canceled: true, items: [], error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'attachment-create-from-path',
    async (
      _event,
      payload: AttachmentCreateFromPathRequest
    ): Promise<AttachmentProcessResponse> => {
      try {
        const attachment = await attachmentService.createSourceAttachmentFromPath({
          sourcePath: payload.sourcePath,
          mimeType: payload.mimeType
        })
        return { success: true, attachment }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'attachment-save-file',
    async (_event, payload: AttachmentSaveRequest): Promise<AttachmentProcessResponse> => {
      try {
        const bytes =
          payload?.bytes instanceof Uint8Array
            ? payload.bytes
            : new Uint8Array(payload?.bytes || [])
        if (!bytes.byteLength) return { success: false, error: '附件内容为空' }
        const attachment = await attachmentService.saveAttachment({
          partnerId: payload.partnerId,
          assetBucketId: payload.assetBucketId,
          name: payload.name,
          bytes,
          mimeType: payload.mimeType,
          kind: payload.kind
        })
        return { success: true, attachment }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('workspace-list', async (): Promise<WorkspaceListResponse> => {
    try {
      const workspaces = await workspaceStore.listWorkspaces()
      const items = await Promise.all(
        workspaces.map((workspace) => hydrateWorkspaceListItem(workspace))
      )
      return { items, total: items.length }
    } catch (error) {
      console.error('? [WORKSPACE-LIST] ERROR:', error)
      return { items: [], total: 0 }
    }
  })

  ipcMain.handle(
    'workspace-create',
    async (event, payload: CreateWorkspaceSourceRequest): Promise<WorkspaceMutationResponse> => {
      try {
        const rootPath = String(payload.rootPath || '').trim()
        if (!rootPath) {
          return { success: false, error: '工作空间地址不能为空' }
        }
        const existingWorkspaces = await workspaceStore.listWorkspaces()
        const classified = await workspaceService.classifyCandidateRoot(
          rootPath,
          existingWorkspaces.map((workspace) => workspace.root_path)
        )
        if (classified.sameAsExisting) {
          return {
            success: false,
            error: '该地址已存在',
            conflict: { reason: 'exists', existingPaths: [classified.normalizedRootPath] }
          }
        }
        if (classified.nestedUnderExisting) {
          return {
            success: false,
            error: '不能添加已包含在现有地址内的路径',
            conflict: {
              reason: 'nested',
              existingPaths: classified.nestedUnderExistingRootPaths
            }
          }
        }
        for (const workspace of existingWorkspaces) {
          if (
            classified.containedExistingRootPaths.some((contained) => {
              const left = path.resolve(contained)
              const right = path.resolve(workspace.root_path)
              return process.platform === 'win32'
                ? left.toLowerCase() === right.toLowerCase()
                : left === right
            })
          ) {
            await workspaceStore.deleteWorkspace(workspace.id)
          }
        }
        const workspaceId = uuidv4()
        const now = Date.now()
        const workspace: WorkspaceSource = {
          id: workspaceId,
          root_path: classified.normalizedRootPath,
          created_at: now,
          updated_at: now
        }
        await workspaceStore.saveWorkspace(workspace)
        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'file',
            action: 'scan',
            phase: 'scan',
            stepIndex: 1,
            stepTotal: 2,
            message: '正在扫描目录：已扫描 0 项，发现 0 个可索引文件'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runFileScanJob({ sender: event.sender, job })
        emitSourceListRefresh(event.sender)
        return {
          success: true,
          workspace
        }
      } catch (error) {
        console.error('? [WORKSPACE-CREATE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-delete',
    async (event, workspaceId: string): Promise<DeleteWorkspaceSourceResponse> => {
      try {
        await workspaceStore.deleteWorkspace(String(workspaceId || '').trim())
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWorkspaceId: String(workspaceId || '').trim() }
      } catch (error) {
        console.error('? [WORKSPACE-DELETE] ERROR:', error)
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

        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        const existingWorkspaces = await workspaceStore.listWorkspaces()
        const classified = await workspaceService.classifyCandidateRoot(
          rootPath,
          existingWorkspaces
            .filter((workspace) => workspace.id !== workspaceId)
            .map((workspace) => workspace.root_path)
        )
        if (classified.sameAsExisting) {
          return { success: false, error: '该地址已存在' }
        }
        if (classified.nestedUnderExisting) {
          return { success: false, error: '不能把工作空间设置到已包含在现有地址内的路径' }
        }
        for (const workspace of existingWorkspaces) {
          if (workspace.id === workspaceId) continue
          if (
            classified.containedExistingRootPaths.some(
              (contained) => path.resolve(contained) === path.resolve(workspace.root_path)
            )
          ) {
            await workspaceStore.deleteWorkspace(workspace.id)
          }
        }

        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
        if (activeJob) return { success: false, error: '当前工作空间正在处理文件索引' }
        const normalizedRootPath = classified.normalizedRootPath
        const now = Date.now()
        const oldRecords = await workspaceStore.listWorkspaceFileIndexRecords(workspaceId)
        const oldDocumentIds = oldRecords
          .map((record) => record.document_id)
          .filter((documentId): documentId is string => Boolean(documentId))
        await workspaceStore.deleteWorkspaceFileIndexRecords(workspaceId)
        if (oldDocumentIds.length > 0) await documentsStore.deleteDocumentsByIds(oldDocumentIds)
        const workspace: WorkspaceSource = {
          ...currentWorkspace,
          root_path: normalizedRootPath,
          updated_at: now
        }
        await workspaceStore.saveWorkspace(workspace)
        const jobKey = getWorkspaceIndexJobKey(workspaceId, 'file')
        const job = await saveAndEmitWorkspaceIndexJob(
          createWorkspaceIndexJob({
            workspaceId,
            sourceKind: 'file',
            action: 'scan',
            phase: 'scan',
            stepIndex: 1,
            stepTotal: 1,
            message: '正在扫描工作目录'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runFileScanJob({ sender: event.sender, job })
        emitSourceListRefresh(event.sender)
        return { success: true, workspace }
      } catch (error) {
        console.error('? [WORKSPACE-SET-ROOT-PATH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-tree',
    async (_event, payload: ListWorkspaceTreeRequest): Promise<WorkspaceTreeListResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const records = await workspaceStore.listWorkspaceFileIndexRecords(workspaceId)
        const items: WorkspaceTreeEntry[] = records.map((record) => ({
          id: `${workspaceId}:file:${record.relative_path}`,
          workspace_id: workspaceId,
          kind: 'file',
          name: record.name,
          relative_path: record.relative_path,
          absolute_path: record.absolute_path,
          file_ext: record.file_ext || undefined,
          supported_for_index: true,
          size: record.size,
          mtime_ms: record.mtime_ms,
          index_status: record.index_status,
          document_id: record.document_id,
          indexed_at: record.indexed_at,
          last_error: record.last_error
        }))
        return {
          items,
          total: items.length,
          summary: await workspaceStore.getWorkspaceFileSummary(workspaceId)
        }
      } catch (error) {
        console.error('? [WORKSPACE-TREE] ERROR:', error)
        return { items: [], total: 0, summary: workspaceStore.getEmptySummary() }
      }
    }
  )

  ipcMain.handle(
    'workspace-directory-list',
    async (
      _event,
      payload: ListWorkspaceDirectoryRequest
    ): Promise<WorkspaceDirectoryListResponse> => {
      try {
        const workspaceId = String(payload?.workspaceId || '').trim()
        const workspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!workspace?.root_path) return { items: [], total: 0, error: '当前工作区没有文件目录' }
        const items = await workspaceService.listDirectory({
          workspaceId,
          rootPath: workspace.root_path,
          relativePath: payload?.relativePath
        })
        const records = await workspaceStore.listWorkspaceFileIndexRecordsByPaths(
          workspaceId,
          items.filter((item) => item.kind === 'file').map((item) => item.relative_path)
        )
        const mergedItems = workspaceService.mergeTreeWithIndex({ entries: items, records })
        const summary = await workspaceStore.getWorkspaceFileSummary(workspaceId)
        return { items: mergedItems, total: mergedItems.length, summary }
      } catch (error) {
        return {
          items: [],
          total: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle(
    'workspace-file-create',
    async (_event, payload: WorkspaceFileCreateRequest): Promise<WorkspaceFileEntryResponse> => {
      try {
        const workspace = await workspaceStore.getWorkspaceById(payload.workspaceId)
        if (!workspace) throw new Error('当前工作目录已被移除')
        const entry = await workspaceFileService.createFile({
          ...payload,
          rootPath: workspace.root_path
        })
        return { success: true, entry }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-file-rename',
    async (_event, payload: WorkspaceFileRenameRequest): Promise<WorkspaceFileEntryResponse> => {
      try {
        const workspace = await workspaceStore.getWorkspaceById(payload.workspaceId)
        if (!workspace) throw new Error('当前工作目录已被移除')
        const entry = await workspaceFileService.renameFile({
          ...payload,
          rootPath: workspace.root_path
        })
        return { success: true, entry }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-file-trash',
    async (_event, payload: WorkspaceFileTrashRequest): Promise<WorkspaceFileMutationResponse> => {
      try {
        const workspace = await workspaceStore.getWorkspaceById(payload.workspaceId)
        if (!workspace) throw new Error('当前工作目录已被移除')
        await workspaceFileService.trashFile(
          { rootPath: workspace.root_path, relativePath: payload.relativePath },
          (filePath) => shell.trashItem(filePath)
        )
        return { success: true }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-scan',
    async (event, payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => {
      try {
        const workspaceId = String(payload.workspaceId || '').trim()
        if (!workspaceId) return { success: false, error: 'workspaceId is required' }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
        if (activeJob) return { success: true, workspaceId, job: activeJob }
        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        if (!currentWorkspace.root_path) {
          return { success: false, error: '请先设置工作目录' }
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
            stepTotal: 2,
            message: '正在扫描目录：已扫描 0 项，发现 0 个可索引文件'
          })
        )
        activeWorkspaceIndexJobs.add(jobKey)
        void runFileScanJob({ sender: event.sender, job })
        return { success: true, workspaceId, job }
      } catch (error) {
        console.error('? [WORKSPACE-SCAN] ERROR:', error)
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
        if (prepareController.isCancelled('file')) {
          return { success: true, workspaceId, cancelled: true }
        }
        const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'file')
        if (activeJob) return { success: true, workspaceId, job: activeJob }

        const currentWorkspace = await workspaceStore.getWorkspaceById(workspaceId)
        if (!currentWorkspace) {
          return { success: false, error: 'workspace not found' }
        }
        if (!currentWorkspace.root_path) {
          return { success: false, error: '请先设置工作目录' }
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
        await runFilePrepareJob({ sender: event.sender, job })
        const finished = await workspaceIndexJobStore.getJobById(job.id)
        return {
          success: true,
          workspaceId,
          job: finished || job,
          cancelled: finished?.status === 'cancelled'
        }
      } catch (error) {
        return { success: false, error: getErrorMessage(error), workspaceId }
      }
    }
  )

  ipcMain.handle('web-source-list', async (): Promise<WebSourceListResponse> => {
    try {
      await ensureWebSourcesHydrated()
      const [items, summary] = await Promise.all([
        webSourceStore.listWebSources(),
        webSourceStore.getWebSummary()
      ])
      return { items, total: items.length, summary }
    } catch (error) {
      console.error('? [WEB-SOURCE-LIST] ERROR:', error)
      return {
        items: [],
        total: 0,
        summary: { web_count: 0, needs_index_count: 0, failed_count: 0 }
      }
    }
  })

  ipcMain.handle(
    'workspace-index-job-get',
    async (_event, payload: WorkspaceIndexJobGetRequest): Promise<WorkspaceIndexJobResponse> => {
      try {
        const sourceKind = payload?.sourceKind === 'web' ? 'web' : 'file'
        const workspaceId =
          sourceKind === 'web' ? WEB_INDEX_OWNER : String(payload?.workspaceId || '').trim()
        if (!workspaceId) return { success: false, error: 'workspaceId is required' }
        const job = await workspaceIndexJobStore.getActiveJob(workspaceId, sourceKind)
        return { success: true, job: job || undefined }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-index-prepare-session-begin',
    async (
      _event,
      payload: WorkspaceIndexPrepareSessionBeginRequest
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const sourceKind = payload?.sourceKind === 'web' ? 'web' : 'file'
        prepareController.beginSession(sourceKind)
        return { success: true }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'workspace-index-cancel',
    async (
      _event,
      payload: WorkspaceIndexCancelRequest
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const sourceKind = payload?.sourceKind === 'web' ? 'web' : 'file'
        const runningJobs = await workspaceIndexJobStore.listRunningJobs()
        const hasRunningPrepare = runningJobs.some(
          (runningJob) => runningJob.source_kind === sourceKind && runningJob.action === 'prepare'
        )
        prepareController.requestCancel(sourceKind)
        if (hasRunningPrepare) {
          await workspaceKnowledgePrepareService.abortActivePrepare()
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('web-sources-scan', async (event): Promise<WorkspaceJobResponse> => {
    const workspaceId = WEB_INDEX_OWNER
    try {
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
  })

  ipcMain.handle('web-sources-prepare', async (event): Promise<WorkspaceJobResponse> => {
    const workspaceId = WEB_INDEX_OWNER
    try {
      const activeJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
      if (activeJob) return { success: true, workspaceId, job: activeJob }
      const jobKey = getWorkspaceIndexJobKey(workspaceId, 'web')
      if (activeWorkspaceIndexJobs.has(jobKey)) {
        const runningJob = await workspaceIndexJobStore.getActiveJob(workspaceId, 'web')
        if (runningJob) return { success: true, workspaceId, job: runningJob }
        return { success: false, workspaceId, error: 'workspace web job already running' }
      }
      prepareController.beginSession('web')
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
  })

  ipcMain.handle(
    'web-source-refresh',
    async (event, payload: RefreshWebSourceRequest): Promise<WebSourceMutationResponse> => {
      try {
        const webSourceId = String(payload?.webSourceId || '').trim()
        await ensureWebSourcesHydrated()
        if (!webSourceId) {
          return { success: false, error: 'webSourceId is required' }
        }
        const source = await webSourceStore.getWebSourceById(webSourceId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        const refreshed = await refreshWebSourceRecord(event, source)
        return { success: true, source: refreshed.source }
      } catch (error) {
        console.error('? [WEB-SOURCE-REFRESH] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'web-source-delete',
    async (event, payload: DeleteWebSourceRequest): Promise<DeleteWebSourceResponse> => {
      try {
        const safeId = String(payload?.webSourceId || '').trim()
        await ensureWebSourcesHydrated()
        if (!safeId) {
          return { success: false, error: 'webSourceId is required' }
        }
        const source = await webSourceStore.getWebSourceById(safeId)
        if (!source) {
          return { success: false, error: 'web source not found' }
        }
        if (source.document_id) {
          await documentsStore.deleteDocumentsByIds([source.document_id])
        }
        await webSourceStore.deleteWebSource(safeId)
        emitSourceListRefresh(event.sender)
        return { success: true, deletedWebSourceId: safeId }
      } catch (error) {
        console.error('? [WEB-SOURCE-DELETE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'reference-item-list',
    async (_event, payload: ListReferenceItemsRequest): Promise<ReferenceItemListResponse> => {
      try {
        await ensureWebSourcesHydrated()
        const referenceKindFilters = normalizeReferenceKindFilters(payload.referenceKinds)
        return await listReferenceItemsPage(
          {
            listWorkspaces: () => workspaceStore.listWorkspaces(),
            listWorkspaceFileIndexRecords: (workspaceId) =>
              workspaceStore.listWorkspaceFileIndexRecords(workspaceId),
            listDirectory: (input) => workspaceService.listDirectory(input),
            listWebSources: () => webSourceStore.listWebSources(),
            normalizeWorkspaceRoot: (rootPath) => workspaceService.normalizeWorkspaceRoot(rootPath)
          },
          payload || {},
          referenceKindFilters
        )
      } catch (error) {
        console.error('? [REFERENCE-ITEM-LIST] ERROR:', error)
        return { items: [], total: 0, hasMore: false, offset: 0, limit: 50 }
      }
    }
  )

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }
      const buffer = fs.readFileSync(filePath)
      return buffer
    } catch (error) {
      console.error('? [READ-FILE] ERROR:', error)
      throw error
    }
  })

  ipcMain.handle('file-exists', (_event, filePath: string): boolean => {
    const normalizedPath = String(filePath || '').trim()
    return Boolean(normalizedPath) && fs.existsSync(normalizedPath)
  })

  ipcMain.handle(
    'write-text-file',
    async (_event, payload: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
      try {
        const filePath = String(payload?.filePath || '').trim()
        if (!filePath) return { success: false, error: 'path is required' }
        if (typeof payload?.content !== 'string') {
          return { success: false, error: 'content must be a string' }
        }

        const result = writeTextFileAtomically(
          filePath,
          payload.content,
          payload.expectedHash,
          true
        )
        if (!result.ok) {
          return {
            success: false,
            conflict: result.conflict,
            error: result.error || '写入失败'
          }
        }
        return { success: true, hash: result.hash }
      } catch (error) {
        console.error('? [WRITE-TEXT-FILE] ERROR:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('download-model', async (_event, repoId: string, source?: unknown) => {
    try {
      return await vectorModelDownloadService.startDownload(
        repoId,
        isModelSource(source) ? source : undefined
      )
    } catch (error) {
      console.error('? [DOWNLOAD-MODEL] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('get-active-download', async () => {
    return vectorModelDownloadService.getActiveDownload()
  })

  ipcMain.handle('delete-model', async (_event, repoId: string) => {
    try {
      return await vectorModelDownloadService.deleteModel(repoId)
    } catch (error) {
      console.error('??[DELETE-MODEL] ERROR:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('get-models', async () => {
    return modelService.getModels()
  })

  ipcMain.handle('get-embedding-status', () => {
    return embeddingService.getRuntimeSnapshot()
  })

  const requireEmbeddingModels = (): EmbeddingModelService => {
    if (!services.embeddingModelService) throw new Error('向量模型配置服务未就绪。')
    return services.embeddingModelService
  }
  ipcMain.handle('embedding-models-get', () => requireEmbeddingModels().getSnapshot())
  const mutateEmbeddingModel = async (
    operation: () => Promise<import('../../shared/embeddingModels').EmbeddingModelsSnapshot>
  ) => {
    try {
      return { success: true, snapshot: await operation() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }
  ipcMain.handle('embedding-model-save', (_event, input: RemoteEmbeddingModelInput) =>
    mutateEmbeddingModel(() => requireEmbeddingModels().saveRemote(input))
  )
  ipcMain.handle('embedding-model-select', (_event, id: string) =>
    mutateEmbeddingModel(() => requireEmbeddingModels().select(id))
  )
  ipcMain.handle('embedding-model-delete', (_event, id: string) =>
    mutateEmbeddingModel(() => requireEmbeddingModels().deleteRemote(id))
  )
  ipcMain.handle('embedding-index-control', (_event, action: 'pause' | 'resume' | 'retry') =>
    mutateEmbeddingModel(() => requireEmbeddingModels().control(action))
  )
  ipcMain.handle('embedding-model-test', async (_event, input: RemoteEmbeddingModelInput) => {
    try {
      return { success: true, dimension: await requireEmbeddingModels().test(input) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('ai-run-cancel', async (_event, runId: string): Promise<AiRunCancelResponse> => {
    return await chatRunService.cancelRun(runId)
  })

  ipcMain.handle('ai-context-usage-get', async (_event, payload?: { partnerId?: string }) => {
    try {
      const partnerId = String(payload?.partnerId || '').trim()
      if (!partnerId) return { success: false, error: 'partnerId is required' }
      const usage = await getAiContextUsage({
        partnerId,
        chatMessageLogStore,
        workbenchUiStore
      })
      return { success: true, ...usage }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'browser-panel-set-bounds',
    async (_event, payload: BrowserPanelBoundsRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        browserEmbedService.setBounds(
          String(payload?.tabId || ''),
          Number(payload?.presentationId || 0),
          {
            x: Number(payload?.x || 0),
            y: Number(payload?.y || 0),
            width: Number(payload?.width || 0),
            height: Number(payload?.height || 0)
          }
        )
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.on('browser-panel-set-follow', (_event, payload: BrowserPanelFollowRequest) => {
    if (!browserEmbedService) return
    browserEmbedService.setFollowLayout({
      splitLeft: Number(payload?.splitLeft || 0),
      rightMargin: Number(payload?.rightMargin || 0),
      ratio: Number(payload?.ratio || 0),
      minWidth: Number(payload?.minWidth || 0),
      middleMin: Number(payload?.middleMin || 0),
      maxRatio: Number(payload?.maxRatio || 0)
    })
  })

  ipcMain.handle(
    'browser-tab-list',
    async (_event, payload: BrowserTabListRequest): Promise<BrowserTabListResponse> => {
      try {
        if (!browserEmbedService)
          return { success: false, tabs: [], error: 'browser service unavailable' }
        return { success: true, tabs: browserEmbedService.listTabs(String(payload?.ownerId || '')) }
      } catch (e) {
        return { success: false, tabs: [], error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-create',
    async (_event, payload: BrowserTabCreateRequest): Promise<BrowserTabCreateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return {
          success: true,
          state: await browserEmbedService.createTab(String(payload?.ownerId || ''))
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-activate',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return {
          success: true,
          state: browserEmbedService.activateTab(String(payload?.tabId || ''))
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-close',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        await browserEmbedService.closeTab(String(payload?.tabId || ''))
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-show',
    async (
      _event,
      payload?: BrowserPanelShowRequest
    ): Promise<BrowserPanelPresentationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        const presentationId = browserEmbedService.show(String(payload?.tabId || ''))
        return { success: true, presentationId }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-hide',
    async (_event, payload?: BrowserPanelHideRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        browserEmbedService.hide(payload?.presentationId)
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-open-menu',
    async (_event, payload: BrowserPanelMenuRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        await browserEmbedService.popupMenu(
          String(payload?.tabId || ''),
          Number(payload?.x || 0),
          Number(payload?.y || 0)
        )
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('browser-panel-close-menu', (): BrowserPanelMutationResponse => {
    if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
    browserEmbedService.closePopupMenu()
    return { success: true }
  })

  ipcMain.handle(
    'browser-resource-menu-open',
    async (_event, payload: BrowserResourceMenuRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        await browserEmbedService.popupResourceMenu(
          Number(payload?.x || 0),
          Number(payload?.y || 0)
        )
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-capture',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelCaptureResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        const dataUrl = await browserEmbedService.capture(String(payload?.tabId || ''))
        return { success: true, ...(dataUrl ? { dataUrl } : {}) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-navigate',
    async (_event, payload: BrowserTabNavigateRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        await browserEmbedService.navigate(String(payload?.url || ''), String(payload?.tabId || ''))
        return { success: true, state: browserEmbedService.getState(String(payload?.tabId || '')) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-back',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return {
          success: true,
          state: await browserEmbedService.goBack(String(payload?.tabId || ''))
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-tab-forward',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return {
          success: true,
          state: await browserEmbedService.goForward(String(payload?.tabId || ''))
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-reload',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        browserEmbedService.reload(String(payload?.tabId || ''))
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-stop',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        browserEmbedService.stop(String(payload?.tabId || ''))
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-open-external',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelMutationResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        browserEmbedService.openExternal(String(payload?.tabId || ''))
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-state-get',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return { success: true, state: browserEmbedService.getState(String(payload?.tabId || '')) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-zoom-in',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return { success: true, state: browserEmbedService.zoomIn(String(payload?.tabId || '')) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-zoom-out',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return { success: true, state: browserEmbedService.zoomOut(String(payload?.tabId || '')) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'browser-panel-zoom-reset',
    async (_event, payload: BrowserTabMutationRequest): Promise<BrowserPanelStateResponse> => {
      try {
        if (!browserEmbedService) return { success: false, error: 'browser service unavailable' }
        return { success: true, state: browserEmbedService.zoomReset(String(payload?.tabId || '')) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'ai-run-approval-batch-decide',
    async (
      _event,
      payload: AiRunApprovalBatchDecisionRequest
    ): Promise<AiRunApprovalBatchDecisionResponse> => {
      return await chatRunService.decideApprovalBatch(payload)
    }
  )

  ipcMain.handle(
    'ai-run-human-interaction-submit',
    async (_event, payload: AiRunHumanInteractionRequest): Promise<AiRunHumanInteractionResponse> =>
      await chatRunService.submitHumanInteraction(payload)
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
    'ai-file-change-list',
    async (
      _event,
      payload?: ListAiFileChangeRecordsRequest
    ): Promise<ListAiFileChangeRecordsResponse> => {
      try {
        return await aiFileChangeService.listRecords(payload)
      } catch (e: unknown) {
        console.error('[AI-FILE-CHANGE-LIST] Error:', e)
        return { items: [], total: 0 }
      }
    }
  )

  ipcMain.handle(
    'ai-file-change-get',
    async (
      _event,
      payload: GetAiFileChangeRecordRequest
    ): Promise<GetAiFileChangeRecordResponse> => {
      try {
        return await aiFileChangeService.getRecord(payload)
      } catch (e: unknown) {
        console.error('[AI-FILE-CHANGE-GET] Error:', e)
        return { error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'ai-file-change-revert',
    async (_event, payload: RevertAiFileChangeRequest): Promise<RevertAiFileChangeResponse> => {
      try {
        const current = await aiFileChangeService.getRecord({ changeId: payload.changeId })
        if (current.record?.capability === 'docx') {
          const docxResponse = await docxApplyService.revertRecord({
            applyId: payload.changeId,
            force: payload.force
          })
          if (!docxResponse.record && docxResponse.error === 'docx apply record not found') {
            return await aiFileChangeService.revertRecord(payload)
          }
          return {
            success: docxResponse.success,
            record: docxResponse.record
              ? {
                  id: docxResponse.record.id,
                  partnerId: docxResponse.record.partner_id,
                  runId: docxResponse.record.run_id,
                  status: docxResponse.record.status,
                  capability: 'docx',
                  path: docxResponse.record.source_path,
                  fileName: docxResponse.record.source_name,
                  operation: docxResponse.record.operation,
                  changeCount: docxResponse.record.change_count,
                  insertCount: docxResponse.record.insert_count,
                  deleteCount: docxResponse.record.delete_count,
                  beforeSnapshotPath: docxResponse.record.before_snapshot_path,
                  beforeChecksum: docxResponse.record.before_checksum,
                  afterChecksum: docxResponse.record.after_checksum,
                  previewPath: docxResponse.record.preview_diff_artifact_path,
                  createdAt: docxResponse.record.created_at,
                  updatedAt: docxResponse.record.updated_at,
                  revertedAt: docxResponse.record.reverted_at,
                  error: docxResponse.record.error
                }
              : undefined,
            requiresForce: docxResponse.requiresForce,
            warning: docxResponse.warning,
            error: docxResponse.error
          }
        }
        return await aiFileChangeService.revertRecord(payload)
      } catch (e: unknown) {
        console.error('[AI-FILE-CHANGE-REVERT] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  // === Chat & LLM Handlers ===

  ipcMain.handle('chat-session-list', async (): Promise<PartnerListItem[]> => {
    try {
      const [
        partners,
        activePartnerIds,
        unreadCompletedPartnerIds,
        latestUserInputs,
        waitingInteractionRuns
      ] = await Promise.all([
        partnerStore.listPartners(),
        aiRunStore.listPartnerIdsByRunStatuses(['running', 'waiting_human', 'waiting_approval']),
        partnerStore.listUnreadCompletedPartnerIds(),
        aiRunStore.listLatestUserInputs(),
        aiRunStore.listRunsByStatuses(['waiting_human', 'waiting_approval'])
      ])
      const activePartnerIdSet = new Set(activePartnerIds)
      const unreadCompletedPartnerIdSet = new Set(unreadCompletedPartnerIds)
      const assistancePartnerIdSet = new Set(
        waitingInteractionRuns
          .filter((run) => run.pendingInteraction?.kind === 'question')
          .map((run) => run.partnerId)
      )
      return partners.map((partner) => {
        const latest = latestUserInputs.get(partner.id)
        return {
          ...partner,
          isRunning: activePartnerIdSet.has(partner.id),
          needsAssistance: assistancePartnerIdSet.has(partner.id),
          hasUnreadCompletion: unreadCompletedPartnerIdSet.has(partner.id),
          lastUserMessagePreview: latest?.preview ?? null,
          lastActivityAt: latest?.createdAt ?? partner.created_at
        }
      })
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle(
    'partner-create',
    async (_event, payload: PartnerCreateRequest): Promise<PartnerCreateResponse> => {
      try {
        const name = String(payload?.name || '').trim()
        if (!name) return { success: false, error: '请填写伙伴名称' }
        const now = Date.now()
        const partner: Partner = {
          id: uuidv4(),
          name,
          avatar_shape: payload.avatar_shape,
          avatar_color: payload.avatar_color,
          created_at: now,
          updated_at: now,
          last_viewed_at: now,
          pinned: false,
          pinned_at: null
        }
        await partnerStore.savePartner(partner)
        await workbenchUiStore.savePartnerState(partner.id, createEmptyPartnerUiState())
        return { success: true, partner }
      } catch (e: unknown) {
        console.error('[PARTNER-CREATE] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'partner-update',
    async (_event, payload: PartnerUpdateRequest): Promise<PartnerUpdateResponse> => {
      try {
        const id = String(payload?.id || '').trim()
        const name = String(payload?.name || '').trim()
        if (!id) return { success: false, error: '伙伴不存在' }
        if (!name) return { success: false, error: '请填写伙伴名称' }
        const existing = await partnerStore.getPartner(id)
        if (!existing) return { success: false, error: '伙伴不存在' }
        const partner: Partner = {
          ...existing,
          name,
          avatar_shape: payload.avatar_shape,
          avatar_color: payload.avatar_color
        }
        await partnerStore.savePartner(partner)
        return { success: true, partner }
      } catch (e: unknown) {
        console.error('[PARTNER-UPDATE] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle('chat-session-save', async (_event, partner: Partner) => {
    try {
      const existing = await partnerStore.getPartner(partner.id)
      await partnerStore.savePartner(partner)
      if (!existing) {
        await workbenchUiStore.savePartnerState(partner.id, createEmptyPartnerUiState())
      }
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-SAVE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle(
    'chat-session-ui-state-save',
    async (_event, payload: PartnerUiStateSaveRequest): Promise<PartnerUiStateSaveResponse> => {
      try {
        const updatedAt = await workbenchUiStore.savePartnerState(payload.partnerId, payload.state)
        return { success: true, updatedAt }
      } catch (e: unknown) {
        console.error('[CHAT-SESSION-UI-STATE-SAVE] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle('workbench-ui-state-get', async (): Promise<WorkbenchUiStateResponse> => {
    try {
      return { success: true, state: await workbenchUiStore.getWorkbenchState() }
    } catch (e: unknown) {
      console.error('[WORKBENCH-UI-STATE-GET] Error:', e)
      return {
        success: false,
        state: { activeViewKey: null, updatedAt: 0 },
        error: getErrorMessage(e)
      }
    }
  })

  ipcMain.handle(
    'workbench-ui-state-save',
    async (_event, payload: WorkbenchUiStateSaveRequest): Promise<WorkbenchUiStateResponse> => {
      try {
        return { success: true, state: await workbenchUiStore.saveWorkbenchState(payload) }
      } catch (e: unknown) {
        console.error('[WORKBENCH-UI-STATE-SAVE] Error:', e)
        return {
          success: false,
          state: { activeViewKey: null, updatedAt: 0 },
          error: getErrorMessage(e)
        }
      }
    }
  )

  ipcMain.handle('chat-session-mark-viewed', async (_event, id: string) => {
    try {
      await partnerStore.markPartnerViewed(id)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-MARK-VIEWED] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-session-set-pinned', async (_event, payload: PartnerSetPinnedRequest) => {
    try {
      await partnerStore.setPartnerPinned(payload.id, payload.pinned)
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-SET-PINNED] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-session-delete', async (_event, id: string) => {
    try {
      await storageService.scheduledTask.clearPartner(id, Date.now())
      await chatRunService.deletePartner(id)
      await browserEmbedService?.closeOwnerTabs(id)
      emitSessionListRefreshToAll()
      return { success: true }
    } catch (e: unknown) {
      console.error('[CHAT-SESSION-DELETE] Error:', e)
      return { success: false, error: getErrorMessage(e) }
    }
  })

  ipcMain.handle('chat-message-list', async (_event, partnerId: string) => {
    try {
      return await chatRunService.listPartnerMessages(partnerId)
    } catch (e: unknown) {
      console.error('[CHAT-MESSAGE-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle(
    'chat-session-open',
    async (_event, payload: PartnerOpenRequest): Promise<PartnerOpenResponse> => {
      try {
        const [opened, uiState] = await Promise.all([
          chatRunService.openPartner(payload),
          workbenchUiStore.getPartnerState(payload.partnerId)
        ])
        browserEmbedService?.listTabs(payload.partnerId)
        return { ...opened, ...(uiState ? { uiState } : {}) }
      } catch (e: unknown) {
        console.error('[CHAT-SESSION-OPEN] Error:', e)
        return { messages: [], hasMoreBefore: false, activeRuns: [] }
      }
    }
  )

  ipcMain.handle(
    'chat-session-run-summaries',
    async (_event, payload: PartnerRunSummariesRequest): Promise<PartnerRunSummariesResponse> => {
      try {
        return await chatRunService.getPartnerRunSummaries(payload?.partnerId)
      } catch (e: unknown) {
        console.error('[CHAT-SESSION-RUN-SUMMARIES] Error:', e)
        return { runs: [] }
      }
    }
  )

  ipcMain.handle(
    'chat-session-snapshot-get',
    async (_event, payload: PartnerSnapshotRequest): Promise<PartnerSnapshotResponse> => {
      try {
        return await chatRunService.getPartnerSnapshot(payload?.partnerId)
      } catch (e: unknown) {
        console.error('[CHAT-SESSION-SNAPSHOT-GET] Error:', e)
        return { messages: [], runs: [], activeRuns: [] }
      }
    }
  )

  ipcMain.handle(
    'partner-clear-context',
    async (_event, payload: PartnerClearContextRequest): Promise<PartnerClearContextResponse> => {
      try {
        const result = await chatRunService.clearPartnerContext(
          payload?.partnerId,
          payload?.deleteFileChanges === true
        )
        if (result.success) emitSessionListRefreshToAll()
        return result
      } catch (e: unknown) {
        console.error('[PARTNER-CLEAR-CONTEXT] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle('partner-cache-preview', async (_event, payload: PartnerCacheRequest) => {
    return await partnerCacheService.preview(payload)
  })
  ipcMain.handle('partner-cache-cleanup', async (_event, payload: PartnerCacheRequest) => {
    const result = await partnerCacheService.cleanup(payload)
    if (result.deletedCount) emitSessionListRefreshToAll()
    return result
  })
  ipcMain.handle(
    'partner-cache-open-directory',
    async (_event, payload: PartnerCacheOpenRequest) => {
      try {
        const directory = await partnerCacheService.directory(payload.partnerId, payload.category)
        const error = await shell.openPath(directory)
        return error ? { success: false, error } : { success: true }
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'chat-submit',
    async (_event, payload: ChatSubmitRequest): Promise<ChatSubmitResponse> => {
      try {
        return await chatRunService.submit(payload)
      } catch (e: unknown) {
        console.error('[CHAT-SUBMIT] Error:', e)
        return { success: false, error: getErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'chat-turn-retract-latest',
    async (
      _event,
      payload: ChatTurnRetractLatestRequest
    ): Promise<ChatTurnRetractLatestResponse> => {
      try {
        return await chatRunService.retractLatestTurn(payload)
      } catch (e: unknown) {
        console.error('[CHAT-TURN-RETRACT-LATEST] Error:', e)
        return { success: false, messages: [], error: getErrorMessage(e) }
      }
    }
  )

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
      const check = await validateLlmConfigForSave(llmStore, config)
      if (!check.ok) {
        return { success: false, error: check.error }
      }
      await llmStore.save(check.config)
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

  ipcMain.handle('free-models-get', async (_event, options?: { refreshIfStale?: boolean }) => {
    try {
      return await FreeModelCatalogService.getInstance().getSnapshot({
        refreshIfStale: options?.refreshIfStale === true
      })
    } catch (e: unknown) {
      console.error('[FREE-MODELS-GET] Error:', e)
      return { updatedAt: null, fetchedAt: null, models: [] }
    }
  })

  ipcMain.handle('free-models-refresh', async () => {
    const catalog = FreeModelCatalogService.getInstance()
    try {
      return {
        success: true as const,
        snapshot: await catalog.refresh()
      }
    } catch (e: unknown) {
      console.error('[FREE-MODELS-REFRESH] Error:', e)
      const snapshot = await catalog.getSnapshot()
      return {
        success: false as const,
        snapshot,
        error: getErrorMessage(e)
      }
    }
  })

  ipcMain.handle('preset-models-get', async (_event, options?: { refreshIfStale?: boolean }) => {
    try {
      return await PresetModelCatalogService.getInstance().getSnapshot({
        refreshIfStale: options?.refreshIfStale === true
      })
    } catch (e: unknown) {
      console.error('[PRESET-MODELS-GET] Error:', e)
      return emptyPresetModelsSnapshot()
    }
  })

  ipcMain.handle('preset-models-refresh', async () => {
    const catalog = PresetModelCatalogService.getInstance()
    try {
      return {
        success: true as const,
        snapshot: await catalog.refresh()
      }
    } catch (e: unknown) {
      console.error('[PRESET-MODELS-REFRESH] Error:', e)
      const snapshot = await catalog.getSnapshot()
      return {
        success: false as const,
        snapshot,
        error: getErrorMessage(e)
      }
    }
  })

  ipcMain.handle('app-settings-get', async () => {
    try {
      return await appSettingsStore.get()
    } catch (e: unknown) {
      console.error('[APP-SETTINGS-GET] Error:', e)
      return {
        systemNotificationsEnabled: true,
        knowledgeIndexSpeed: 'slow',
        language: 'system',
        serviceRoute: getAppRuntime().serviceRoute
      }
    }
  })

  ipcMain.handle('app-settings-save', async (_event, settings: Partial<AppSettings>) => {
    try {
      const previous = await appSettingsStore.get()
      if (
        settings.knowledgeIndexSpeed !== undefined &&
        previous.knowledgeIndexSpeed !== settings.knowledgeIndexSpeed &&
        (await workspaceIndexJobStore.hasRunningPrepareJob())
      ) {
        return { success: false, error: '正在更新索引，请完成后再切换速度' }
      }
      const saved = await appSettingsStore.save(settings)
      setServiceRoute(saved.serviceRoute)
      if (previous.knowledgeIndexSpeed !== saved.knowledgeIndexSpeed) {
        if (services.embeddingModelService) {
          await services.embeddingModelService.applyIndexSpeed(saved.knowledgeIndexSpeed)
        } else {
          await embeddingService.applyIndexSpeed(saved.knowledgeIndexSpeed)
        }
      }
      return { success: true, settings: saved }
    } catch (e: unknown) {
      console.error('[APP-SETTINGS-SAVE] Error:', e)
      return {
        success: false,
        error: getErrorMessage(e),
        ...(e instanceof AppSettingsError ? { errorCode: e.code } : {})
      }
    }
  })

  ipcMain.handle('error-log-open-directory', async () => {
    if (!errorLogService) return { success: false, error: '错误日志服务未初始化' }
    try {
      errorLogService.ensureDirectory()
      const error = await shell.openPath(errorLogService.getDirectoryPath())
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'app-error-log-renderer',
    (_event, payload: { message?: string; stack?: string }) => {
      const error = new Error(String(payload?.message || 'Renderer error'))
      if (typeof payload?.stack === 'string' && payload.stack) error.stack = payload.stack
      errorLogService?.write({
        module: 'renderer',
        error
      })
      return { success: true }
    }
  )

  // === Scheduled Task Handlers ===

  ipcMain.handle('user-skills-list', () => userSkillService.list())
  ipcMain.handle('user-skills-import', async (event) => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'dontAddToRecent'] }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return userSkillService.importFolder(result.filePaths[0])
  })
  ipcMain.handle('user-skills-create', (_event, request: UserSkillCreateRequest) =>
    userSkillService.create(request?.content)
  )
  ipcMain.handle('user-skills-delete', (_event, id: string) => userSkillService.delete(id))
  ipcMain.handle('user-skills-get-enabled', (_event, partnerId: string) =>
    userSkillService.listEnabled(partnerId).map((skill) => skill.id)
  )
  ipcMain.handle('user-skills-set-enabled', (_event, request: UserSkillSetEnabledRequest) =>
    userSkillService.setEnabled(request?.partnerId, request?.skillIds)
  )

  ipcMain.handle('scheduled-task-list', async () => {
    try {
      return await scheduledTaskService.list()
    } catch (e: unknown) {
      console.error('[SCHEDULED-TASK-LIST] Error:', e)
      return []
    }
  })

  ipcMain.handle(
    'scheduled-task-save',
    async (_event, payload: ScheduledTaskSaveRequest): Promise<ScheduledTaskMutationResponse> => {
      return scheduledTaskService.save(payload)
    }
  )

  ipcMain.handle(
    'scheduled-task-delete',
    async (_event, id: string): Promise<ScheduledTaskMutationResponse> => {
      return scheduledTaskService.delete(id)
    }
  )

  ipcMain.handle(
    'scheduled-task-set-enabled',
    async (
      _event,
      payload: ScheduledTaskSetEnabledRequest
    ): Promise<ScheduledTaskMutationResponse> => {
      return scheduledTaskService.setEnabled(payload)
    }
  )

  ipcMain.handle(
    'scheduled-task-run-now',
    async (_event, payload: ScheduledTaskRunNowRequest): Promise<ScheduledTaskMutationResponse> => {
      return scheduledTaskService.runNow(payload)
    }
  )

  ipcMain.handle(
    'scheduled-task-dismiss-busy-notice',
    async (
      _event,
      payload: ScheduledTaskDismissBusyNoticeRequest
    ): Promise<ScheduledTaskMutationResponse> => {
      return scheduledTaskService.dismissBusyNotice(payload)
    }
  )
}
