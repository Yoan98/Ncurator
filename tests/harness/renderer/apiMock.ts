import type { DesktopApi, DownloadProgress, ModelInfo } from '../../../src/preload/api'
import type {
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
  DeleteWebSourceResponse,
  DeleteWorkspaceSourceResponse,
  DraftReviewDetail,
  DocumentRecord,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  LegacyLocalImportMigrationStatus,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  ListSourceScopesRequest,
  ListWorkspaceNodesRequest,
  LLMConfig,
  PrepareWorkspaceRequest,
  RefreshWebSourceRequest,
  SearchResponse,
  SearchSourceFilter,
  SetDraftChangeDecisionRequest,
  SetDraftChangeDecisionResponse,
  SourceScopeListResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse,
  WebIngestPayload,
  WebSourceListResponse,
  WebSourceMutationResponse,
  WorkspaceJobResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceNodeListResponse
} from '../../../src/shared/types'

type ListenerRecord = {
  aiRunEvent: Array<(event: AiRunEvent) => void>
  sourceListRefresh: Array<() => void>
  downloadProgress: Array<(progress: DownloadProgress) => void>
}

type CallRecord = {
  aiRunStart: AiRunStartRequest[]
  aiRunApprovalDecide: AiRunApprovalDecisionRequest[]
  aiRunCancel: string[]
  search: Array<{ query: string; sourceType?: SearchSourceFilter; documentIds?: string[] }>
  sourceScopeList: ListSourceScopesRequest[]
  draftReviewList: ListDraftReviewsRequest[]
  draftReviewGet: GetDraftReviewRequest[]
  draftReviewSetDecision: SetDraftChangeDecisionRequest[]
  draftReviewValidate: ValidateDraftCommitRequest[]
  draftReviewCommit: CommitDraftReviewRequest[]
}

export type DesktopApiMock = {
  api: DesktopApi
  calls: CallRecord
  callSequence: string[]
  emittedAiRunEvents: AiRunEvent[]
  listeners: ListenerRecord
  emitAiRunEvent: (event: AiRunEvent) => void
  emitSourceListRefresh: () => void
  emitDownloadProgress: (progress: DownloadProgress) => void
}

type DesktopApiMockOptions = {
  sessions?: ChatSession[]
  messagesBySessionId?: Record<string, ChatMessage[]>
  sourceScopes?: SourceScopeListResponse['items']
  searchResponse?: SearchResponse
  aiRunStartResponse?: AiRunStartResponse
  aiRunApprovalDecisionResponse?: AiRunApprovalDecisionResponse
  aiRunCancelResponse?: AiRunCancelResponse
  llmConfigs?: LLMConfig[]
  models?: ModelInfo[]
  documents?: DocumentRecord[]
  listChunksResponse?: ChunkListResponse
  workspaceListResponse?: WorkspaceListResponse
  webSourceListResponse?: WebSourceListResponse
  draftReviews?: DraftReviewDetail[]
  draftCommitValidation?: ValidateDraftCommitResponse
  draftCommitResponse?: CommitDraftReviewResponse
}

const defaultWorkspaceListResponse: WorkspaceListResponse = {
  items: [],
  total: 0
}

const defaultWebSourceListResponse: WebSourceListResponse = {
  items: [],
  total: 0
}

const defaultChunkListResponse: ChunkListResponse = {
  items: [],
  total: 0
}

const defaultSourceScopeListResponse = (
  items: SourceScopeListResponse['items']
): SourceScopeListResponse => ({
  items,
  total: items.length
})

export const createDesktopApiMock = (options: DesktopApiMockOptions = {}): DesktopApiMock => {
  const listeners: ListenerRecord = {
    aiRunEvent: [],
    sourceListRefresh: [],
    downloadProgress: []
  }
  const calls: CallRecord = {
    aiRunStart: [],
    aiRunApprovalDecide: [],
    aiRunCancel: [],
    search: [],
    sourceScopeList: [],
    draftReviewList: [],
    draftReviewGet: [],
    draftReviewSetDecision: [],
    draftReviewValidate: [],
    draftReviewCommit: []
  }
  const callSequence: string[] = []
  const emittedAiRunEvents: AiRunEvent[] = []
  const sessions = options.sessions || []
  const messagesBySessionId = options.messagesBySessionId || {}
  const sourceScopes = options.sourceScopes || []
  const searchResponse = options.searchResponse || { results: [], tokens: [] }
  const aiRunStartResponse = options.aiRunStartResponse || { success: true, runId: 'run-test-1' }
  const aiRunApprovalDecisionResponse = options.aiRunApprovalDecisionResponse || { success: true }
  const aiRunCancelResponse = options.aiRunCancelResponse || { success: true }
  const llmConfigs = options.llmConfigs || []
  const models = options.models || []
  const documents = options.documents || []
  const listChunksResponse = options.listChunksResponse || defaultChunkListResponse
  const workspaceListResponse = options.workspaceListResponse || defaultWorkspaceListResponse
  const webSourceListResponse = options.webSourceListResponse || defaultWebSourceListResponse
  let draftReviews = options.draftReviews || []
  let draftCommitValidation = options.draftCommitValidation || { ready: true, issues: [] }
  const draftCommitResponse = options.draftCommitResponse || { success: true }

  const api: DesktopApi = {
    ingestWeb: async (_payload: WebIngestPayload) => ({ success: true, count: 1 }),
    ingestWebs: async (_payload: WebIngestPayload[]) => ({ success: true, created: 1 }),
    openExternal: async (_url: string) => ({ success: true }),
    openPath: async (_filePath: string) => ({ success: true }),
    revealPath: async (_filePath: string) => ({ success: true }),
    search: async (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) => {
      callSequence.push('search')
      calls.search.push({ query, sourceType, documentIds })
      return searchResponse
    },
    ftsSearch: async (_query: string, _sourceType?: SearchSourceFilter, _documentIds?: string[]) =>
      [],
    vectorSearch: async (
      _query: string,
      _sourceType?: SearchSourceFilter,
      _documentIds?: string[]
    ) => [],
    hybridSearch: async (
      _query: string,
      _sourceType?: SearchSourceFilter,
      _documentIds?: string[]
    ) => [],
    listDocuments: async (_payload: { keyword?: string; page: number; pageSize: number }) => ({
      items: documents,
      total: documents.length
    }),
    workspaceList: async () => workspaceListResponse,
    workspaceCreate: async (
      _payload: CreateWorkspaceSourceRequest
    ): Promise<WorkspaceMutationResponse> => ({
      success: true
    }),
    workspaceDelete: async (_workspaceId: string): Promise<DeleteWorkspaceSourceResponse> => ({
      success: true
    }),
    workspaceNodes: async (_payload: ListWorkspaceNodesRequest): Promise<WorkspaceNodeListResponse> => ({
      items: [],
      total: 0
    }),
    workspaceScan: async (_payload: { workspaceId: string }): Promise<WorkspaceJobResponse> => ({
      success: true
    }),
    workspacePrepare: async (_payload: PrepareWorkspaceRequest): Promise<WorkspaceJobResponse> => ({
      success: true
    }),
    sourceScopeList: async (payload: ListSourceScopesRequest) => {
      callSequence.push('sourceScopeList')
      calls.sourceScopeList.push(payload)
      return defaultSourceScopeListResponse(sourceScopes)
    },
    webSourceList: async () => webSourceListResponse,
    webSourceRefresh: async (_payload: RefreshWebSourceRequest): Promise<WebSourceMutationResponse> => ({
      success: true
    }),
    webSourceDelete: async (_webSourceId: string): Promise<DeleteWebSourceResponse> => ({
      success: true
    }),
    legacyLocalImportMigrationStatus: async (): Promise<LegacyLocalImportMigrationStatus | null> => null,
    listChunks: async (_payload: { keyword?: string; page: number; pageSize: number }) =>
      listChunksResponse,
    deleteDocuments: async (_ids: string[]) => ({ success: true, deletedDocs: 0, deletedChunks: 0 }),
    dropDocumentsTable: async () => ({ success: true, existed: true }),
    sourceListRefresh: (cb: () => void) => {
      listeners.sourceListRefresh.push(cb)
    },
    removeSourceListRefreshListeners: () => {
      listeners.sourceListRefresh = []
    },
    downloadModel: async (_repoId: string) => ({ success: true }),
    onDownloadProgress: (cb: (progressData: DownloadProgress) => void) => {
      listeners.downloadProgress.push(cb)
    },
    removeDownloadProgressListeners: () => {
      listeners.downloadProgress = []
    },
    getModels: async () => models,
    getEmbeddingStatus: async () => 'ready',
    readFile: async (_filePath: string) => new Uint8Array(),
    chatSessionList: async () => sessions,
    chatSessionSave: async (_session: ChatSession) => ({ success: true }),
    chatSessionDelete: async (_id: string) => ({ success: true }),
    chatMessageList: async (sessionId: string) => messagesBySessionId[sessionId] || [],
    chatMessageSave: async (_message: ChatMessage) => ({ success: true }),
    llmConfigList: async () => llmConfigs,
    llmConfigSave: async (_config: LLMConfig) => ({ success: true }),
    llmConfigDelete: async (_id: string) => ({ success: true }),
    llmConfigSetActive: async (_id: string) => ({ success: true }),
    aiRunStart: async (payload: AiRunStartRequest) => {
      callSequence.push('aiRunStart')
      calls.aiRunStart.push(payload)
      return aiRunStartResponse
    },
    aiRunCancel: async (runId: string) => {
      callSequence.push('aiRunCancel')
      calls.aiRunCancel.push(runId)
      return aiRunCancelResponse
    },
    aiRunApprovalDecide: async (payload: AiRunApprovalDecisionRequest) => {
      callSequence.push('aiRunApprovalDecide')
      calls.aiRunApprovalDecide.push(payload)
      return aiRunApprovalDecisionResponse
    },
    draftReviewList: async (payload?: ListDraftReviewsRequest): Promise<ListDraftReviewsResponse> => {
      callSequence.push('draftReviewList')
      calls.draftReviewList.push(payload || {})
      const filtered = payload?.sessionId
        ? draftReviews.filter((item) => item.review.session_id === payload.sessionId)
        : draftReviews
      return {
        items: filtered.map((item) => item.review),
        total: filtered.length
      }
    },
    draftReviewGet: async (payload: GetDraftReviewRequest): Promise<GetDraftReviewResponse> => {
      callSequence.push('draftReviewGet')
      calls.draftReviewGet.push(payload)
      const review = draftReviews.find((item) => item.review.id === payload.reviewId)
      return review ? { review } : { error: 'review not found' }
    },
    draftReviewSetDecision: async (
      payload: SetDraftChangeDecisionRequest
    ): Promise<SetDraftChangeDecisionResponse> => {
      callSequence.push('draftReviewSetDecision')
      calls.draftReviewSetDecision.push(payload)
      const review = draftReviews.find((item) => item.review.id === payload.reviewId)
      if (!review) return { success: false, error: 'review not found' }
      const change = review.changes.find((item) => item.id === payload.changeId)
      if (!change) return { success: false, error: 'change not found' }
      change.decision = payload.decision
      change.updated_at = Date.now()
      review.review.pending_change_count = review.changes.filter((item) => item.decision === 'pending').length
      review.review.accepted_change_count = review.changes.filter((item) => item.decision === 'accepted').length
      review.review.rejected_change_count = review.changes.filter((item) => item.decision === 'rejected').length
      review.review.status = review.review.pending_change_count > 0 ? 'review_pending' : 'commit_ready'
      review.documents = review.documents.map((document) => ({
        ...document,
        pending_change_count: review.changes.filter(
          (item) => item.document_id === document.id && item.decision === 'pending'
        ).length,
        accepted_change_count: review.changes.filter(
          (item) => item.document_id === document.id && item.decision === 'accepted'
        ).length,
        rejected_change_count: review.changes.filter(
          (item) => item.document_id === document.id && item.decision === 'rejected'
        ).length
      }))
      return { success: true, review: review.review, change, document: review.documents.find((item) => item.id === change.document_id) }
    },
    draftReviewValidate: async (
      payload: ValidateDraftCommitRequest
    ): Promise<ValidateDraftCommitResponse> => {
      callSequence.push('draftReviewValidate')
      calls.draftReviewValidate.push(payload)
      if (!options.draftCommitValidation) {
        const review = draftReviews.find((item) => item.review.id === payload.reviewId)
        if (!review) {
          return {
            ready: false,
            issues: [{ code: 'review_not_found', message: 'review not found' }]
          }
        }
        const hasPending = review.changes.some((item) => item.decision === 'pending')
        return hasPending
          ? {
              ready: false,
              issues: [{ code: 'pending_changes', message: 'pending changes' }]
            }
          : { ready: true, issues: [] }
      }
      return draftCommitValidation
    },
    draftReviewCommit: async (
      payload: CommitDraftReviewRequest
    ): Promise<CommitDraftReviewResponse> => {
      callSequence.push('draftReviewCommit')
      calls.draftReviewCommit.push(payload)
      if (draftCommitResponse.success) {
        draftReviews = draftReviews.map((review) =>
          review.review.id === payload.reviewId
            ? {
                ...review,
                review: {
                  ...review.review,
                  status: 'committed',
                  committed_at: Date.now()
                },
                commit_jobs: draftCommitResponse.job
                  ? [...review.commit_jobs, draftCommitResponse.job]
                  : review.commit_jobs
              }
            : review
        )
      }
      return draftCommitResponse
    },
    onAiRunEvent: (cb: (event: AiRunEvent) => void) => {
      listeners.aiRunEvent.push(cb)
    },
    removeAiRunEventListeners: () => {
      listeners.aiRunEvent = []
    }
  }

  return {
    api,
    calls,
    callSequence,
    emittedAiRunEvents,
    listeners,
    emitAiRunEvent: (event: AiRunEvent) => {
      emittedAiRunEvents.push(event)
      listeners.aiRunEvent.forEach((listener) => listener(event))
    },
    emitSourceListRefresh: () => {
      listeners.sourceListRefresh.forEach((listener) => listener())
    },
    emitDownloadProgress: (progress: DownloadProgress) => {
      listeners.downloadProgress.forEach((listener) => listener(progress))
    }
  }
}
