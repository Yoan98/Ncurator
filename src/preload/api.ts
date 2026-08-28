import type { ModelSource } from '../shared/modelSources'
import type {
  AiRuntimeSettings,
  BrowserPanelBoundsRequest,
  BrowserPanelHideRequest,
  BrowserPanelMenuRequest,
  BrowserPanelMutationResponse,
  BrowserPanelCaptureResponse,
  BrowserResourceMenuAction,
  BrowserResourceMenuRequest,
  BrowserPanelPresentationResponse,
  BrowserPanelShowRequest,
  BrowserPanelState,
  BrowserPanelStateResponse,
  BrowserTabCreateRequest,
  BrowserTabCreateResponse,
  BrowserTabListRequest,
  BrowserTabListResponse,
  BrowserTabMutationRequest,
  BrowserTabNavigateRequest,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  AiRunCancelResponse,
  AiContextUsageRequest,
  AiContextUsageResponse,
  AiRunEvent,
  AppUpdateActionResponse,
  AppUpdateSnapshot,
  ChatMessage,
  AttachmentPickRequest,
  AttachmentPickResponse,
  AttachmentCreateFromPathRequest,
  AttachmentProcessResponse,
  AttachmentSaveRequest,
  ChatSession,
  ChatSessionListItem,
  ChatSessionOpenRequest,
  ChatSessionOpenResponse,
  ChatSessionUiStateSaveRequest,
  ChatSessionUiStateSaveResponse,
  ChatSessionRunSummariesRequest,
  ChatSessionRunSummariesResponse,
  ChatSessionSnapshotRequest,
  ChatSessionSnapshotResponse,
  ChatSubmitRequest,
  ChatSubmitResponse,
  ChatTurnRetractLatestRequest,
  ChatTurnRetractLatestResponse,
  CreateWorkspaceSourceRequest,
  DeleteWebSourceRequest,
  DeleteWebSourceResponse,
  DeleteWorkspaceSourceResponse,
  FileWatchChangeEvent,
  FileWatchCheckResponse,
  FileWatchMutationRequest,
  FileWatchStartRequest,
  FileWatchStartResponse,
  FileWatchStopResponse,
  LegacyLocalImportMigrationStatus,
  ListReferenceItemsRequest,
  ListWebSourcesRequest,
  ListWorkspaceTreeRequest,
  ListWorkspaceDirectoryRequest,
  LLMConfig,
  LlmModelListResponse,
  PrepareWorkspaceRequest,
  RefreshWebSourceRequest,
  SearchResponse,
  SearchSourceFilter,
  PickDirectoryResponse,
  PickFileResponse,
  ListOpenWithApplicationsRequest,
  ListOpenWithApplicationsResponse,
  OpenFileWithApplicationRequest,
  OpenFileWithApplicationResponse,
  PrepareWebSourcesRequest,
  ReferenceItemListResponse,
  ScanWebSourcesRequest,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WebIngestPayload,
  SetWorkspaceRootPathRequest,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse,
  RevertAiFileChangeRequest,
  RevertAiFileChangeResponse,
  ScheduledTask,
  ScheduledTaskMutationResponse,
  ScheduledTaskSaveRequest,
  ScheduledTaskSetEnabledRequest,
  WorkspaceIndexJobGetRequest,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobResponse,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceTreeListResponse,
  WorkspaceDirectoryListResponse,
  WorkbenchUiStateResponse,
  WorkbenchUiStateSaveRequest,
  WriteTextFileRequest,
  WriteTextFileResponse
} from '../shared/types'

export type ModelInfo = {
  id: string
  name: string
  description: string
  tags: string[]
  isDownloaded: boolean
}

export type DownloadProgress = {
  repoId: string
  file?: string
  status: 'downloading' | 'completed' | 'error' | 'cancelled'
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
  source?: ModelSource
  failedSource?: ModelSource
}

export type ActiveDownloadSnapshot = {
  repoId: string
  status: 'downloading'
  progress: number
  currentFile: string
  totalFiles: number
  completedFiles: number
  source: ModelSource
  updatedAt: number
}

export type DesktopApi = {
  ingestWeb: (
    payload: WebIngestPayload
  ) => Promise<{ success: boolean; count?: number; error?: string }>
  ingestWebs: (
    payload: WebIngestPayload[]
  ) => Promise<{ success: boolean; created?: number; error?: string }>
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
  openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
  fileWatchStart: (payload: FileWatchStartRequest) => Promise<FileWatchStartResponse>
  fileWatchCheck: (payload: FileWatchMutationRequest) => Promise<FileWatchCheckResponse>
  fileWatchStop: (payload: FileWatchMutationRequest) => Promise<FileWatchStopResponse>
  onFileWatchChange: (cb: (event: FileWatchChangeEvent) => void) => () => void
  revealPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
  pickDirectory: () => Promise<PickDirectoryResponse>
  pickFile: (defaultPath?: string) => Promise<PickFileResponse>
  search: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) => Promise<SearchResponse>
  workspaceList: () => Promise<WorkspaceListResponse>
  workspaceCreate: (payload: CreateWorkspaceSourceRequest) => Promise<WorkspaceMutationResponse>
  workspaceSetRootPath: (payload: SetWorkspaceRootPathRequest) => Promise<WorkspaceMutationResponse>
  workspaceDelete: (workspaceId: string) => Promise<DeleteWorkspaceSourceResponse>
  workspaceTree: (payload: ListWorkspaceTreeRequest) => Promise<WorkspaceTreeListResponse>
  workspaceDirectoryList: (
    payload: ListWorkspaceDirectoryRequest
  ) => Promise<WorkspaceDirectoryListResponse>
  workspaceScan: (payload: { workspaceId: string }) => Promise<WorkspaceJobResponse>
  workspacePrepare: (payload: PrepareWorkspaceRequest) => Promise<WorkspaceJobResponse>
  workspaceIndexJobGet: (payload: WorkspaceIndexJobGetRequest) => Promise<WorkspaceIndexJobResponse>
  onWorkspaceIndexJobProgress: (cb: (job: WorkspaceIndexJobRecord) => void) => () => void
  referenceItemList: (payload: ListReferenceItemsRequest) => Promise<ReferenceItemListResponse>
  webSourceList: (payload: ListWebSourcesRequest) => Promise<WebSourceListResponse>
  webSourcesScan: (payload: ScanWebSourcesRequest) => Promise<WorkspaceJobResponse>
  webSourcesPrepare: (payload: PrepareWebSourcesRequest) => Promise<WorkspaceJobResponse>
  webSourceRefresh: (payload: RefreshWebSourceRequest) => Promise<WebSourceMutationResponse>
  webSourceDelete: (payload: DeleteWebSourceRequest) => Promise<DeleteWebSourceResponse>
  legacyLocalImportMigrationStatus: () => Promise<LegacyLocalImportMigrationStatus | null>
  sourceListRefresh: (cb: () => void) => () => void
  downloadModel: (
    repoId: string,
    source?: ModelSource
  ) => Promise<{ success: boolean; error?: string }>
  onDownloadProgress: (cb: (progressData: DownloadProgress) => void) => void
  removeDownloadProgressListeners: () => void
  getActiveDownload: () => Promise<ActiveDownloadSnapshot | null>
  deleteModel: (repoId: string) => Promise<{ success: boolean; error?: string }>
  getModels: () => Promise<ModelInfo[]>
  getEmbeddingStatus: () => Promise<'uninitialized' | 'initializing' | 'ready' | 'error'>
  readFile: (filePath: string) => Promise<Uint8Array>
  fileExists: (filePath: string) => Promise<boolean>
  writeTextFile: (payload: WriteTextFileRequest) => Promise<WriteTextFileResponse>
  attachmentPick: (payload: AttachmentPickRequest) => Promise<AttachmentPickResponse>
  attachmentGetSourcePath: (file: File) => string
  attachmentCreateFromPath: (
    payload: AttachmentCreateFromPathRequest
  ) => Promise<AttachmentProcessResponse>
  attachmentSaveFile: (payload: AttachmentSaveRequest) => Promise<AttachmentProcessResponse>
  chatSessionList: () => Promise<ChatSessionListItem[]>
  chatSessionSave: (session: ChatSession) => Promise<{ success: boolean; error?: string }>
  chatSessionMarkViewed: (id: string) => Promise<{ success: boolean; error?: string }>
  chatSessionDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  chatMessageList: (sessionId: string) => Promise<ChatMessage[]>
  scheduledTaskList: () => Promise<ScheduledTask[]>
  scheduledTaskSave: (payload: ScheduledTaskSaveRequest) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskDelete: (id: string) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskSetEnabled: (
    payload: ScheduledTaskSetEnabledRequest
  ) => Promise<ScheduledTaskMutationResponse>
  onChatSessionListRefresh: (cb: () => void) => () => void
  chatSessionOpen: (payload: ChatSessionOpenRequest) => Promise<ChatSessionOpenResponse>
  chatSessionUiStateSave: (
    payload: ChatSessionUiStateSaveRequest
  ) => Promise<ChatSessionUiStateSaveResponse>
  workbenchUiStateGet: () => Promise<WorkbenchUiStateResponse>
  workbenchUiStateSave: (payload: WorkbenchUiStateSaveRequest) => Promise<WorkbenchUiStateResponse>
  chatSessionRunSummaries: (
    payload: ChatSessionRunSummariesRequest
  ) => Promise<ChatSessionRunSummariesResponse>
  chatSessionSnapshotGet: (
    payload: ChatSessionSnapshotRequest
  ) => Promise<ChatSessionSnapshotResponse>
  chatSubmit: (payload: ChatSubmitRequest) => Promise<ChatSubmitResponse>
  chatTurnRetractLatest: (
    payload: ChatTurnRetractLatestRequest
  ) => Promise<ChatTurnRetractLatestResponse>
  llmConfigList: () => Promise<LLMConfig[]>
  llmConfigSave: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>
  llmConfigDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  llmConfigModelList: (id: string) => Promise<LlmModelListResponse>
  isE2EMode: () => boolean
  aiRuntimeSettingsGet: () => Promise<AiRuntimeSettings>
  aiRuntimeSettingsSave: (
    settings: AiRuntimeSettings
  ) => Promise<{ success: boolean; settings?: AiRuntimeSettings; error?: string }>
  errorLogOpenDirectory: () => Promise<{ success: boolean; error?: string }>
  aiRunCancel: (runId: string) => Promise<AiRunCancelResponse>
  aiRunApprovalBatchDecide: (
    payload: AiRunApprovalBatchDecisionRequest
  ) => Promise<AiRunApprovalBatchDecisionResponse>
  aiContextUsageGet: (payload: AiContextUsageRequest) => Promise<AiContextUsageResponse>
  browserPanelSetBounds: (
    payload: BrowserPanelBoundsRequest
  ) => Promise<BrowserPanelMutationResponse>
  browserTabList: (payload: BrowserTabListRequest) => Promise<BrowserTabListResponse>
  browserTabCreate: (payload: BrowserTabCreateRequest) => Promise<BrowserTabCreateResponse>
  browserTabActivate: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserTabClose: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelMutationResponse>
  browserTabNavigate: (payload: BrowserTabNavigateRequest) => Promise<BrowserPanelStateResponse>
  browserTabBack: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserTabForward: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserPanelShow: (payload: BrowserPanelShowRequest) => Promise<BrowserPanelPresentationResponse>
  browserPanelHide: (payload?: BrowserPanelHideRequest) => Promise<BrowserPanelMutationResponse>
  browserPanelOpenMenu: (payload: BrowserPanelMenuRequest) => Promise<BrowserPanelMutationResponse>
  browserPanelCloseMenu: () => Promise<BrowserPanelMutationResponse>
  browserPanelCapture: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelCaptureResponse>
  browserResourceMenuOpen: (
    payload: BrowserResourceMenuRequest
  ) => Promise<BrowserPanelMutationResponse>
  browserPanelReload: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelMutationResponse>
  browserPanelStop: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelMutationResponse>
  browserPanelOpenExternal: (
    payload: BrowserTabMutationRequest
  ) => Promise<BrowserPanelMutationResponse>
  browserPanelStateGet: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserPanelZoomIn: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserPanelZoomOut: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  browserPanelZoomReset: (payload: BrowserTabMutationRequest) => Promise<BrowserPanelStateResponse>
  onBrowserPanelStateChange: (cb: (state: BrowserPanelState) => void) => () => void
  onBrowserResourceMenuAction: (cb: (action: BrowserResourceMenuAction) => void) => () => void
  docxApplyGet: (payload: GetDocxApplyRecordRequest) => Promise<GetDocxApplyRecordResponse>
  aiFileChangeList: (
    payload?: ListAiFileChangeRecordsRequest
  ) => Promise<ListAiFileChangeRecordsResponse>
  aiFileChangeGet: (payload: GetAiFileChangeRecordRequest) => Promise<GetAiFileChangeRecordResponse>
  aiFileChangeRevert: (payload: RevertAiFileChangeRequest) => Promise<RevertAiFileChangeResponse>
  appUpdateGetSnapshot: () => Promise<AppUpdateSnapshot>
  appUpdateCheck: () => Promise<AppUpdateActionResponse>
  appUpdateDownload: () => Promise<AppUpdateActionResponse>
  appUpdateInstall: () => Promise<AppUpdateActionResponse>
  onAppUpdateStatus: (cb: (snapshot: AppUpdateSnapshot) => void) => () => void
  listOpenWithApplications: (
    payload: ListOpenWithApplicationsRequest
  ) => Promise<ListOpenWithApplicationsResponse>
  openFileWithApplication: (
    payload: OpenFileWithApplicationRequest
  ) => Promise<OpenFileWithApplicationResponse>
  onAiRunEvent: (cb: (event: AiRunEvent) => void) => () => void
  onSystemNotificationOpenSession: (cb: (sessionId: string) => void) => () => void
  onWorkbenchUiFlushRequest: (cb: () => void | Promise<void>) => () => void
}
