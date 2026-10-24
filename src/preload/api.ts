import type {
  UserSkill,
  UserSkillOption,
  UserSkillCreateRequest,
  UserSkillDocument,
  UserSkillUpdateRequest,
  UserSkillImportPreview,
  UserSkillImportCommitRequest,
  UserSkillSelection,
  UserSkillSource,
  UserSkillResourcePreview
} from '../shared/userSkills'
import type { AppSettingsErrorCode } from '../shared/appErrors'
import type {
  GetFileReviewResponse,
  OpenFileReviewLocationRequest,
  ReviewNavigationResult
} from '../shared/fileReview'
import type { ModelSource } from '../shared/modelSources'
import type { WpsIntegrationNotice } from '../shared/wpsIntegration'
import type {
  PartnerCacheRequest,
  PartnerCachePreview,
  PartnerCacheCleanupResult,
  PartnerCacheOpenRequest
} from '../shared/partnerCache'
import type { FreeModelsSnapshot } from '../shared/freeModels'
import type { PresetModelsSnapshot } from '../shared/llmPresets'
import type {
  AppSettings,
  ConfirmDialogRequest,
  ConfirmDialogResponse,
  BrowserPanelBoundsRequest,
  BrowserPanelFollowRequest,
  BrowserPanelHideRequest,
  BrowserPanelMenuRequest,
  BrowserPanelMutationResponse,
  BrowserPanelCaptureResponse,
  BrowserResourceMenuAction,
  BrowserResourceMenuRequest,
  BrowserPanelPresentationResponse,
  BrowserPanelShowRequest,
  BrowserPanelStateResponse,
  BrowserTabCreateRequest,
  BrowserTabCreateResponse,
  BrowserTabListRequest,
  BrowserTabListResponse,
  BrowserTabMutationRequest,
  BrowserTabNavigateRequest,
  BrowserTabState,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  AiRunHumanInteractionRequest,
  AiRunHumanInteractionResponse,
  AiRunCancelResponse,
  AiContextUsageRequest,
  AiContextUsageResponse,
  AiRunEvent,
  AppUpdateActionResponse,
  AppUpdateSnapshot,
  AppStartupStatus,
  EmbeddingRuntimeSnapshot,
  ChatMessage,
  AttachmentPickRequest,
  AttachmentPickResponse,
  AttachmentCreateFromPathRequest,
  AttachmentProcessResponse,
  AttachmentSaveRequest,
  Partner,
  PartnerListItem,
  PartnerCreateRequest,
  PartnerCreateResponse,
  PartnerUpdateRequest,
  PartnerUpdateResponse,
  PartnerClearContextRequest,
  PartnerClearContextResponse,
  PartnerOpenRequest,
  PartnerOpenResponse,
  PartnerSetPinnedRequest,
  PartnerUiStateSaveRequest,
  PartnerUiStateSaveResponse,
  PartnerRunSummariesRequest,
  PartnerRunSummariesResponse,
  PartnerSnapshotRequest,
  PartnerSnapshotResponse,
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
  ListReferenceItemsRequest,
  ListWebSourcesRequest,
  ListWorkspaceTreeRequest,
  ListWorkspaceDirectoryRequest,
  LLMConfig,
  LlmModelListResponse,
  PrepareWorkspaceRequest,
  RefreshWebSourceRequest,
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
  WorkspaceIndexCancelRequest,
  WorkspaceIndexPrepareSessionBeginRequest,
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
  ScheduledTaskRunNowRequest,
  ScheduledTaskDismissBusyNoticeRequest,
  WorkspaceIndexJobGetRequest,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobResponse,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceTreeListResponse,
  WorkspaceDirectoryListResponse,
  WorkspaceFileCreateRequest,
  WorkspaceFileRenameRequest,
  WorkspaceFileEntryResponse,
  WorkspaceFileTrashRequest,
  WorkspaceFileMutationResponse,
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
  workspaceList: () => Promise<WorkspaceListResponse>
  workspaceCreate: (payload: CreateWorkspaceSourceRequest) => Promise<WorkspaceMutationResponse>
  workspaceSetRootPath: (payload: SetWorkspaceRootPathRequest) => Promise<WorkspaceMutationResponse>
  workspaceDelete: (workspaceId: string) => Promise<DeleteWorkspaceSourceResponse>
  workspaceTree: (payload: ListWorkspaceTreeRequest) => Promise<WorkspaceTreeListResponse>
  workspaceDirectoryList: (
    payload: ListWorkspaceDirectoryRequest
  ) => Promise<WorkspaceDirectoryListResponse>
  workspaceFileRename: (payload: WorkspaceFileRenameRequest) => Promise<WorkspaceFileEntryResponse>
  workspaceFileCreate: (payload: WorkspaceFileCreateRequest) => Promise<WorkspaceFileEntryResponse>
  workspaceFileTrash: (payload: WorkspaceFileTrashRequest) => Promise<WorkspaceFileMutationResponse>
  workspaceScan: (payload: { workspaceId: string }) => Promise<WorkspaceJobResponse>
  workspacePrepare: (payload: PrepareWorkspaceRequest) => Promise<WorkspaceJobResponse>
  workspaceIndexPrepareSessionBegin: (
    payload: WorkspaceIndexPrepareSessionBeginRequest
  ) => Promise<{ success: boolean; error?: string }>
  workspaceIndexCancel: (
    payload: WorkspaceIndexCancelRequest
  ) => Promise<{ success: boolean; error?: string }>
  workspaceIndexJobGet: (payload: WorkspaceIndexJobGetRequest) => Promise<WorkspaceIndexJobResponse>
  onWorkspaceIndexJobProgress: (cb: (job: WorkspaceIndexJobRecord) => void) => () => void
  referenceItemList: (payload: ListReferenceItemsRequest) => Promise<ReferenceItemListResponse>
  webSourceList: (payload: ListWebSourcesRequest) => Promise<WebSourceListResponse>
  webSourcesScan: (payload: ScanWebSourcesRequest) => Promise<WorkspaceJobResponse>
  webSourcesPrepare: (payload: PrepareWebSourcesRequest) => Promise<WorkspaceJobResponse>
  webSourceRefresh: (payload: RefreshWebSourceRequest) => Promise<WebSourceMutationResponse>
  webSourceDelete: (payload: DeleteWebSourceRequest) => Promise<DeleteWebSourceResponse>
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
  getEmbeddingStatus: () => Promise<EmbeddingRuntimeSnapshot>
  readFile: (filePath: string) => Promise<Uint8Array>
  fileExists: (filePath: string) => Promise<boolean>
  writeTextFile: (payload: WriteTextFileRequest) => Promise<WriteTextFileResponse>
  attachmentPick: (payload: AttachmentPickRequest) => Promise<AttachmentPickResponse>
  attachmentGetSourcePath: (file: File) => string
  attachmentCreateFromPath: (
    payload: AttachmentCreateFromPathRequest
  ) => Promise<AttachmentProcessResponse>
  attachmentSaveFile: (payload: AttachmentSaveRequest) => Promise<AttachmentProcessResponse>
  partnerList: () => Promise<PartnerListItem[]>
  partnerCreate: (payload: PartnerCreateRequest) => Promise<PartnerCreateResponse>
  partnerUpdate: (payload: PartnerUpdateRequest) => Promise<PartnerUpdateResponse>
  partnerSave: (partner: Partner) => Promise<{ success: boolean; error?: string }>
  partnerMarkViewed: (id: string) => Promise<{ success: boolean; error?: string }>
  partnerSetPinned: (
    payload: PartnerSetPinnedRequest
  ) => Promise<{ success: boolean; error?: string }>
  partnerDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  confirmDialogShow: (payload: ConfirmDialogRequest) => Promise<ConfirmDialogResponse>
  confirmDialogClose: (dialogId: string) => Promise<void>
  partnerMessageList: (partnerId: string) => Promise<ChatMessage[]>
  userSkillsList: () => Promise<UserSkillOption[]>
  userSkillsImport: () => Promise<UserSkillImportPreview | null>
  userSkillsCommitImport: (input: UserSkillImportCommitRequest) => Promise<UserSkill>
  userSkillsCancelImport: (token: string) => Promise<void>
  userSkillsGet: (id: string) => Promise<UserSkillDocument>
  userSkillsPreviewResource: (
    source: UserSkillSource,
    relative: string
  ) => Promise<UserSkillResourcePreview>
  userSkillsOpenFolder: (source: UserSkillSource) => Promise<string>
  userSkillsUpdate: (input: UserSkillUpdateRequest) => Promise<UserSkill>
  userSkillsCreate: (input: UserSkillCreateRequest) => Promise<UserSkill>
  userSkillsDelete: (id: string) => Promise<void>
  userSkillsGetEnabled: (partnerId: string) => Promise<UserSkillSelection>
  scheduledTaskList: () => Promise<ScheduledTask[]>
  scheduledTaskSave: (payload: ScheduledTaskSaveRequest) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskDelete: (id: string) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskSetEnabled: (
    payload: ScheduledTaskSetEnabledRequest
  ) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskRunNow: (
    payload: ScheduledTaskRunNowRequest
  ) => Promise<ScheduledTaskMutationResponse>
  scheduledTaskDismissBusyNotice: (
    payload: ScheduledTaskDismissBusyNoticeRequest
  ) => Promise<ScheduledTaskMutationResponse>
  onPartnerListRefresh: (cb: () => void) => () => void
  partnerOpen: (payload: PartnerOpenRequest) => Promise<PartnerOpenResponse>
  partnerUiStateSave: (payload: PartnerUiStateSaveRequest) => Promise<PartnerUiStateSaveResponse>
  workbenchUiStateGet: () => Promise<WorkbenchUiStateResponse>
  workbenchUiStateSave: (payload: WorkbenchUiStateSaveRequest) => Promise<WorkbenchUiStateResponse>
  partnerRunSummaries: (payload: PartnerRunSummariesRequest) => Promise<PartnerRunSummariesResponse>
  partnerSnapshotGet: (payload: PartnerSnapshotRequest) => Promise<PartnerSnapshotResponse>
  partnerClearContext: (payload: PartnerClearContextRequest) => Promise<PartnerClearContextResponse>
  partnerCachePreview: (payload: PartnerCacheRequest) => Promise<PartnerCachePreview>
  partnerCacheCleanup: (payload: PartnerCacheRequest) => Promise<PartnerCacheCleanupResult>
  partnerCacheOpenDirectory: (
    payload: PartnerCacheOpenRequest
  ) => Promise<{ success: boolean; error?: string }>
  chatSubmit: (payload: ChatSubmitRequest) => Promise<ChatSubmitResponse>
  chatTurnRetractLatest: (
    payload: ChatTurnRetractLatestRequest
  ) => Promise<ChatTurnRetractLatestResponse>
  llmConfigList: () => Promise<LLMConfig[]>
  llmConfigSave: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>
  llmConfigDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  llmConfigModelList: (id: string) => Promise<LlmModelListResponse>
  freeModelsGet: (options?: { refreshIfStale?: boolean }) => Promise<FreeModelsSnapshot>
  freeModelsRefresh: () => Promise<{
    success: boolean
    snapshot: FreeModelsSnapshot
    error?: string
  }>
  presetModelsGet: (options?: { refreshIfStale?: boolean }) => Promise<PresetModelsSnapshot>
  presetModelsRefresh: () => Promise<{
    success: boolean
    snapshot: PresetModelsSnapshot
    error?: string
  }>
  isE2EMode: () => boolean
  appSettingsGet: () => Promise<AppSettings>
  appSettingsSave: (settings: Partial<AppSettings>) => Promise<{
    success: boolean
    settings?: AppSettings
    error?: string
    errorCode?: AppSettingsErrorCode
  }>
  errorLogOpenDirectory: () => Promise<{ success: boolean; error?: string }>
  aiRunCancel: (runId: string) => Promise<AiRunCancelResponse>
  aiRunApprovalBatchDecide: (
    payload: AiRunApprovalBatchDecisionRequest
  ) => Promise<AiRunApprovalBatchDecisionResponse>
  aiRunHumanInteractionSubmit: (
    payload: AiRunHumanInteractionRequest
  ) => Promise<AiRunHumanInteractionResponse>
  aiContextUsageGet: (payload: AiContextUsageRequest) => Promise<AiContextUsageResponse>
  browserPanelSetBounds: (
    payload: BrowserPanelBoundsRequest
  ) => Promise<BrowserPanelMutationResponse>
  browserPanelSetFollow: (payload: BrowserPanelFollowRequest) => void
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
  onBrowserPanelStateChange: (cb: (state: BrowserTabState) => void) => () => void
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
  appStartupGetStatus: () => Promise<AppStartupStatus>
  appQuit: () => Promise<void>
  getFileReview: (request: { changeRecordId: string }) => Promise<GetFileReviewResponse>
  openFileReviewLocation: (
    request: OpenFileReviewLocationRequest
  ) => Promise<ReviewNavigationResult>
  setPreferredOpenApplication: (request: {
    filePath: string
    applicationId: string | null
  }) => Promise<ListOpenWithApplicationsResponse>
  onOpenWithPreferenceChanged: (cb: (extension: string) => void) => () => void
  onWpsIntegrationNotice: (cb: (notice: WpsIntegrationNotice) => void) => () => void
  listOpenWithApplications: (
    payload: ListOpenWithApplicationsRequest
  ) => Promise<ListOpenWithApplicationsResponse>
  openFileWithApplication: (
    payload: OpenFileWithApplicationRequest
  ) => Promise<OpenFileWithApplicationResponse>
  onAiRunEvent: (cb: (event: AiRunEvent) => void) => () => void
  onSystemNotificationOpenPartner: (cb: (partnerId: string) => void) => () => void
  onWorkbenchUiFlushRequest: (cb: () => void | Promise<void>) => () => void
}
