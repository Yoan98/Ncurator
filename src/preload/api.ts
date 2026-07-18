import type {
  AiRuntimeSettings,
  BrowserPanelBoundsRequest,
  BrowserPanelHideRequest,
  BrowserPanelMenuRequest,
  BrowserPanelMutationResponse,
  BrowserPanelOcclusionRequest,
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
  AiRunUserTakeoverConfirmRequest,
  AiRunUserTakeoverConfirmResponse,
  AiRunCancelResponse,
  AiContextUsageRequest,
  AiContextUsageResponse,
  AiRunEvent,
  AppUpdateActionResponse,
  AppUpdateSnapshot,
  ChatMessage,
  AttachmentPickRequest,
  AttachmentPickResponse,
  AttachmentProcessResponse,
  AttachmentSaveRequest,
  ChatRunEventsRequest,
  ChatRunEventsResponse,
  ChatSession,
  ChatSessionListItem,
  ChatSessionOpenRequest,
  ChatSessionOpenResponse,
  ChatSessionRunSummariesRequest,
  ChatSessionRunSummariesResponse,
  ChatSessionSnapshotRequest,
  ChatSessionSnapshotResponse,
  ChatSubmitRequest,
  ChatSubmitResponse,
  ChatTurnRetractLatestRequest,
  ChatTurnRetractLatestResponse,
  ChunkListResponse,
  CreateWorkspaceSourceRequest,
  DeleteWebSourceRequest,
  DeleteWebSourceResponse,
  DeleteWorkspaceSourceResponse,
  DocumentRecord,
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
  SearchResult,
  SearchSourceFilter,
  PickApplicationResponse,
  PickDirectoryResponse,
  PickFileResponse,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
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
  WorkspaceIndexJobGetRequest,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobResponse,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceTreeListResponse,
  WorkspaceDirectoryListResponse
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
  status: 'downloading' | 'completed' | 'error'
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
}

export type ActiveDownloadSnapshot = {
  repoId: string
  status: 'downloading'
  progress: number
  currentFile: string
  totalFiles: number
  completedFiles: number
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
  revealPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
  pickDirectory: () => Promise<PickDirectoryResponse>
  pickFile: (defaultPath?: string) => Promise<PickFileResponse>
  search: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) => Promise<SearchResponse>
  ftsSearch: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) => Promise<SearchResult[]>
  vectorSearch: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) => Promise<SearchResult[]>
  hybridSearch: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) => Promise<SearchResult[]>
  listDocuments: (payload: {
    sourceNameQuery?: string
    page: number
    pageSize: number
  }) => Promise<{ items: DocumentRecord[]; total: number }>
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
  listChunks: (payload: {
    query?: string
    page: number
    pageSize: number
  }) => Promise<ChunkListResponse>
  deleteDocuments: (
    ids: string[]
  ) => Promise<{ success: boolean; deletedDocs?: number; deletedChunks?: number; error?: string }>
  dropDocumentsTable: () => Promise<{ success: boolean; existed?: boolean; error?: string }>
  sourceListRefresh: (cb: () => void) => () => void
  downloadModel: (repoId: string) => Promise<{ success: boolean; error?: string }>
  onDownloadProgress: (cb: (progressData: DownloadProgress) => void) => void
  removeDownloadProgressListeners: () => void
  getActiveDownload: () => Promise<ActiveDownloadSnapshot | null>
  deleteModel: (repoId: string) => Promise<{ success: boolean; error?: string }>
  getModels: () => Promise<ModelInfo[]>
  getEmbeddingStatus: () => Promise<'uninitialized' | 'initializing' | 'ready' | 'error'>
  readFile: (filePath: string) => Promise<Uint8Array>
  attachmentPick: (payload: AttachmentPickRequest) => Promise<AttachmentPickResponse>
  attachmentSaveFile: (payload: AttachmentSaveRequest) => Promise<AttachmentProcessResponse>
  chatSessionList: () => Promise<ChatSessionListItem[]>
  chatSessionSave: (session: ChatSession) => Promise<{ success: boolean; error?: string }>
  chatSessionMarkViewed: (id: string) => Promise<{ success: boolean; error?: string }>
  chatSessionDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  chatMessageList: (sessionId: string) => Promise<ChatMessage[]>
  chatSessionOpen: (payload: ChatSessionOpenRequest) => Promise<ChatSessionOpenResponse>
  chatSessionRunSummaries: (
    payload: ChatSessionRunSummariesRequest
  ) => Promise<ChatSessionRunSummariesResponse>
  chatRunEventsGet: (payload: ChatRunEventsRequest) => Promise<ChatRunEventsResponse>
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
  ) => Promise<{ success: boolean; error?: string }>
  aiRunCancel: (runId: string) => Promise<AiRunCancelResponse>
  aiRunApprovalBatchDecide: (
    payload: AiRunApprovalBatchDecisionRequest
  ) => Promise<AiRunApprovalBatchDecisionResponse>
  aiRunUserTakeoverConfirm: (
    payload: AiRunUserTakeoverConfirmRequest
  ) => Promise<AiRunUserTakeoverConfirmResponse>
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
  browserPanelSetOccluded: (
    payload: BrowserPanelOcclusionRequest
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
  pickApplication: () => Promise<PickApplicationResponse>
  openPathWithApplication: (
    payload: OpenPathWithApplicationRequest
  ) => Promise<OpenPathWithApplicationResponse>
  onAiRunEvent: (cb: (event: AiRunEvent) => void) => () => void
}
