import type {
  AiRuntimeSettings,
  AiRunApprovalDecisionRequest,
  AiRunApprovalDecisionResponse,
  AiRunCancelResponse,
  AiRunEvent,
  AiRunStartRequest,
  AiRunStartResponse,
  ChatMessage,
  ChatSession,
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  ChunkListResponse,
  CreateWorkspaceSourceRequest,
  DeleteWebSourceRequest,
  DeleteWebSourceResponse,
  DeleteWorkspaceSourceResponse,
  DocumentRecord,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  LegacyLocalImportMigrationStatus,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  ListReferenceItemsRequest,
  ListWebSourcesRequest,
  ListWorkspaceNodesRequest,
  LLMConfig,
  PickDirectoryResponse,
  PrepareWorkspaceRequest,
  RefreshWebSourceRequest,
  SearchResponse,
  SearchResult,
  SearchSourceFilter,
  DiscardDraftReviewRequest,
  DiscardDraftReviewResponse,
  PickApplicationResponse,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
  ReferenceItemListResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WebIngestPayload,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceNodeListResponse
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
  status: string
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
}

export type E2EApiOverrides = {
  pickDirectoryResponse?: PickDirectoryResponse
  workspaceListResponse?: WorkspaceListResponse
  workspaceNodesResponseByWorkspaceId?: Record<string, WorkspaceNodeListResponse>
  legacyLocalImportMigrationStatus?: LegacyLocalImportMigrationStatus | null
  llmConfigDeleteResponseById?: Record<string, { success: boolean; error?: string }>
  webSourceRefreshDelayMs?: number
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
    query?: string
    page: number
    pageSize: number
  }) => Promise<{ items: DocumentRecord[]; total: number }>
  workspaceList: () => Promise<WorkspaceListResponse>
  workspaceCreate: (payload: CreateWorkspaceSourceRequest) => Promise<WorkspaceMutationResponse>
  workspaceDelete: (workspaceId: string) => Promise<DeleteWorkspaceSourceResponse>
  workspaceNodes: (payload: ListWorkspaceNodesRequest) => Promise<WorkspaceNodeListResponse>
  workspaceScan: (payload: { workspaceId: string }) => Promise<WorkspaceJobResponse>
  workspacePrepare: (payload: PrepareWorkspaceRequest) => Promise<WorkspaceJobResponse>
  referenceItemList: (
    payload: ListReferenceItemsRequest
  ) => Promise<ReferenceItemListResponse>
  webSourceList: (payload: ListWebSourcesRequest) => Promise<WebSourceListResponse>
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
  sourceListRefresh: (cb: () => void) => void
  removeSourceListRefreshListeners: () => void
  downloadModel: (repoId: string) => Promise<{ success: boolean; error?: string }>
  onDownloadProgress: (cb: (progressData: DownloadProgress) => void) => void
  removeDownloadProgressListeners: () => void
  getModels: () => Promise<ModelInfo[]>
  getEmbeddingStatus: () => Promise<'uninitialized' | 'initializing' | 'ready' | 'error'>
  readFile: (filePath: string) => Promise<Uint8Array>
  chatSessionList: () => Promise<ChatSession[]>
  chatSessionSave: (session: ChatSession) => Promise<{ success: boolean; error?: string }>
  chatSessionDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  chatMessageList: (sessionId: string) => Promise<ChatMessage[]>
  chatMessageSave: (message: ChatMessage) => Promise<{ success: boolean; error?: string }>
  llmConfigList: () => Promise<LLMConfig[]>
  llmConfigSave: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>
  llmConfigDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  llmConfigSetActive: (id: string) => Promise<{ success: boolean; error?: string }>
  setE2EApiOverrides: (overrides: E2EApiOverrides) => void
  clearE2EApiOverrides: () => void
  aiRuntimeSettingsGet: () => Promise<AiRuntimeSettings>
  aiRuntimeSettingsSave: (
    settings: AiRuntimeSettings
  ) => Promise<{ success: boolean; error?: string }>
  aiRunStart: (payload: AiRunStartRequest) => Promise<AiRunStartResponse>
  aiRunCancel: (runId: string) => Promise<AiRunCancelResponse>
  aiRunApprovalDecide: (
    payload: AiRunApprovalDecisionRequest
  ) => Promise<AiRunApprovalDecisionResponse>
  draftReviewList: (payload?: ListDraftReviewsRequest) => Promise<ListDraftReviewsResponse>
  draftReviewGet: (payload: GetDraftReviewRequest) => Promise<GetDraftReviewResponse>
  draftReviewValidate: (payload: ValidateDraftCommitRequest) => Promise<ValidateDraftCommitResponse>
  draftReviewCommit: (payload: CommitDraftReviewRequest) => Promise<CommitDraftReviewResponse>
  draftReviewDiscard: (
    payload: DiscardDraftReviewRequest
  ) => Promise<DiscardDraftReviewResponse>
  pickApplication: () => Promise<PickApplicationResponse>
  openPathWithApplication: (
    payload: OpenPathWithApplicationRequest
  ) => Promise<OpenPathWithApplicationResponse>
  onAiRunEvent: (cb: (event: AiRunEvent) => void) => void
  removeAiRunEventListeners: () => void
}
