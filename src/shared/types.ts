export type DocumentSourceType = 'file' | 'web'
export type DocumentImportStatus = 1 | 2 | 3
export type SearchSourceFilter = 'all' | DocumentSourceType
export type WebSourceIdentityKind = 'normalized_url'
export type WorkspaceSourceStatus =
  | 'not_prepared'
  | 'scanning'
  | 'preparing'
  | 'prepared'
  | 'stale'
  | 'failed'
  | 'unavailable'
export type WorkspaceNodeKind = 'directory' | 'file'
export type WorkspacePrepareStatus =
  | 'not_prepared'
  | 'preparing'
  | 'prepared'
  | 'stale'
  | 'failed'
  | 'missing'
export type WorkspacePrepareMode = 'full' | 'presence_only' | 'changes_only'
export type SourceScopeType = 'workspace' | 'directory' | 'file' | 'web'
export type SourceScopeSourceType = 'workspace' | 'web'
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type IpcJsonPrimitive = JsonPrimitive
export type IpcJsonObject = object
export type IpcJsonArray = IpcJsonValue[]
export type IpcJsonValue = IpcJsonPrimitive | IpcJsonObject | IpcJsonArray

export interface WebIngestPayload {
  url: string
  includeSelectors?: string[]
  excludeSelectors?: string[]
}

export interface DocumentRecord {
  id: string
  name: string
  source_type: DocumentSourceType
  file_path?: string
  created_at: number
  import_status: DocumentImportStatus
  source_id?: string
  source_url?: string
  source_title?: string
  normalized_source_url?: string
  fetched_at?: number
  updated_at?: number
  last_error?: string
}

export interface WebSourceRecord {
  id: string
  identity_kind: WebSourceIdentityKind
  normalized_url: string
  url: string
  title?: string
  document_id?: string
  import_status: DocumentImportStatus
  include_selectors?: string[]
  exclude_selectors?: string[]
  fetched_at?: number
  last_error?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceSource {
  id: string
  name: string
  root_path: string
  status: WorkspaceSourceStatus
  last_scan_at?: number
  last_prepare_at?: number
  last_error?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceNode {
  id: string
  workspace_id: string
  parent_id?: string
  kind: WorkspaceNodeKind
  name: string
  relative_path: string
  absolute_path: string
  file_ext?: string
  exists: boolean
  size?: number
  mtime_ms?: number
  content_hash?: string
  prepare_status: WorkspacePrepareStatus
  document_id?: string
  last_prepared_at?: number
  last_error?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceRuntimeBinding {
  workspaceId: string
  rootPath: string
  policyProfile?: string
}

export interface SourceScopeSelection {
  scopeType: SourceScopeType
  sourceType: SourceScopeSourceType
  sourceId: string
  nodeId?: string
  label: string
  absolutePath?: string
  relativePath?: string
  documentIds: string[]
  hasUnpreparedFiles: boolean
  preparedDocumentCount?: number
  unpreparedFileCount?: number
  workspace?: WorkspaceRuntimeBinding
}

export interface WorkspaceSyncProgress {
  workspace_id: string
  mode?: WorkspacePrepareMode
  phase: 'scan' | 'diff' | 'prepare' | 'complete'
  total: number
  completed: number
  added?: number
  updated?: number
  removed?: number
  failed?: number
  message?: string
}

export interface WorkspaceListResponse {
  items: WorkspaceSource[]
  total: number
}

export interface WorkspaceNodeListResponse {
  items: WorkspaceNode[]
  total: number
}

export interface SourceScopeListResponse {
  items: SourceScopeSelection[]
  total: number
}

export interface WebSourceListResponse {
  items: WebSourceRecord[]
  total: number
}

export interface LegacyLocalImportMigrationStatus {
  hasLegacyLocalImports: boolean
  removedDocumentCount: number
  removedChunkCount: number
  migratedAt?: number
}

export interface CreateWorkspaceSourceRequest {
  rootPath: string
  name?: string
}

export interface UpdateWorkspaceSourceRequest {
  workspaceId: string
  name?: string
  status?: WorkspaceSourceStatus
  lastError?: string
}

export interface WorkspaceMutationResponse {
  success: boolean
  workspace?: WorkspaceSource
  error?: string
}

export interface DeleteWorkspaceSourceResponse {
  success: boolean
  deletedWorkspaceId?: string
  error?: string
}

export interface ListWorkspaceNodesRequest {
  workspaceId: string
  parentId?: string
  kind?: WorkspaceNodeKind
}

export interface ScanWorkspaceRequest {
  workspaceId: string
}

export interface PrepareWorkspaceRequest {
  workspaceId: string
  mode: WorkspacePrepareMode
}

export interface WorkspaceJobResponse {
  success: boolean
  workspaceId?: string
  progress?: WorkspaceSyncProgress
  error?: string
}

export interface RefreshWebSourceRequest {
  webSourceId: string
}

export interface WebSourceMutationResponse {
  success: boolean
  source?: WebSourceRecord
  error?: string
}

export interface DeleteWebSourceResponse {
  success: boolean
  deletedWebSourceId?: string
  error?: string
}

export interface ListSourceScopesRequest {
  query?: string
  mode: 'chat' | 'search'
}

export interface SearchResult {
  id: string
  text: string
  document_name: string
  document_id?: string
  source_type?: string
  // IPC 传输时为 JSON string，后端存储时为对象
  metadata?:
    | string
    | {
        page: number
      }
  _distance?: number
  created_at?: number
  _score?: number
  _relevance_score?: number
  document?: DocumentRecord
}

export interface SearchResponse {
  results: SearchResult[]
  tokens: string[]
}

export interface ChunkListItem {
  id: string
  text: string
  document_name: string
  document_id?: string
  source_type?: string
  // IPC 传输时为 JSON string，后端存储时为对象
  metadata?:
    | string
    | {
        page: number
      }
  created_at?: number
  vector?: number[]
}

export interface ChunkListResponse {
  items: ChunkListItem[]
  total: number
}

// Deprecated: kept for backward compatibility if needed, but should be removed eventually
export interface DocumentListItem extends ChunkListItem {}

export interface DocumentListResponse {
  items: DocumentRecord[]
  total: number
}

// Chat & LLM Types

export interface LLMConfig {
  id: string
  name: string
  base_url: string
  model_name: string
  api_key: string
  is_active: boolean
}

export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  // JSON string of SearchResult[]
  sources?: string
  error?: boolean
}

export interface ChatSession {
  id: string
  title: string
  created_at: number
}

export type DraftDocumentFormat = 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'md' | 'txt'
export type DraftChangeKind =
  | 'block'
  | 'text_hunk'
  | 'table_cell'
  | 'worksheet_range'
  | 'slide_object'
  | 'page_region'
export type DraftChangeDecision = 'pending' | 'accepted' | 'rejected'
export type DraftChangeResolution = Exclude<DraftChangeDecision, 'pending'>
export type DraftReviewStatus =
  | 'review_pending'
  | 'commit_ready'
  | 'committing'
  | 'committed'
  | 'conflicted'
  | 'cancelled'
  | 'failed'
export type DraftArtifactRole = 'preview' | 'draft' | 'committed'
export type DraftCommitJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'conflicted'
export type DraftCommitValidationIssueCode =
  | 'pending_changes'
  | 'source_changed'
  | 'review_not_found'
  | 'review_not_ready'

export interface DraftSourceVersion {
  mtime_ms?: number
  byte_size?: number
  checksum?: string
  content_hash?: string
}

export interface DraftReviewSummary {
  id: string
  session_id: string
  run_id: string
  status: DraftReviewStatus
  title: string
  document_count: number
  change_count: number
  pending_change_count: number
  accepted_change_count: number
  rejected_change_count: number
  created_at: number
  updated_at: number
  completed_at?: number
  committed_at?: number
  last_error?: string
}

export interface DraftReviewDocument {
  id: string
  review_id: string
  source_document_id?: string
  source_path: string
  source_name: string
  format: DraftDocumentFormat
  latest_draft_snapshot_id: string
  preview_artifact_path?: string
  draft_artifact_path?: string
  source_version: DraftSourceVersion
  total_change_count: number
  pending_change_count: number
  accepted_change_count: number
  rejected_change_count: number
  created_at: number
  updated_at: number
}

export interface DraftReviewChange {
  id: string
  review_id: string
  document_id: string
  order_index: number
  change_kind: DraftChangeKind
  title: string
  summary: string
  decision: DraftChangeDecision
  before_text: string
  after_text: string
  locator: JsonObject
  preview_artifact_path?: string
  metadata?: JsonObject
  created_at: number
  updated_at: number
}

export interface DraftCommitResultItem {
  draft_document_id: string
  output_path: string
  operation: AiFileArtifactOperation
  checksum?: string
  byte_size?: number
}

export interface DraftCommitJob {
  id: string
  review_id: string
  status: DraftCommitJobStatus
  document_count: number
  results: DraftCommitResultItem[]
  started_at: number
  completed_at?: number
  error?: string
}

export interface DraftReviewDetail {
  review: DraftReviewSummary
  documents: DraftReviewDocument[]
  changes: DraftReviewChange[]
  commit_jobs: DraftCommitJob[]
}

export interface ListDraftReviewsRequest {
  sessionId?: string
  status?: DraftReviewStatus
}

export interface ListDraftReviewsResponse {
  items: DraftReviewSummary[]
  total: number
}

export interface GetDraftReviewRequest {
  reviewId: string
}

export interface GetDraftReviewResponse {
  review?: DraftReviewDetail
  error?: string
}

export interface SetDraftChangeDecisionRequest {
  reviewId: string
  changeId: string
  decision: DraftChangeResolution
}

export interface SetDraftChangeDecisionResponse {
  success: boolean
  review?: DraftReviewSummary
  document?: DraftReviewDocument
  change?: DraftReviewChange
  error?: string
}

export interface DraftCommitValidationIssue {
  code: DraftCommitValidationIssueCode
  message: string
  documentId?: string
  sourcePath?: string
}

export interface ValidateDraftCommitRequest {
  reviewId: string
}

export interface ValidateDraftCommitResponse {
  ready: boolean
  issues: DraftCommitValidationIssue[]
}

export interface CommitDraftReviewRequest {
  reviewId: string
  overwrite?: boolean
}

export interface CommitDraftReviewResponse {
  success: boolean
  job?: DraftCommitJob
  error?: string
}

export type AiTaskStatus = 'ready' | 'running' | 'completed' | 'blocked'
export type AiRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type RuntimeIssueCode =
  | 'workspace_binding_missing'
  | 'workspace_missing'
  | 'workspace_path_unavailable'
  | 'scope_unavailable'
  | 'approval_denied'
export type RuntimeSkillId =
  | 'workspace-cli'
  | 'docx-read'
  | 'docx-write'
  | 'docx-delivery'
  | 'kb-document-discovery'
  | 'kb-evidence-query'
export type AiRunEventStage =
  | 'director_intent'
  | 'director_context_human'
  | 'director_plan'
  | 'director_plan_exec'
  | 'director_direct_human_exec'
  | 'director_synthesis_human'
  | 'director_complete'
  | 'human_brain'
  | 'human_learning'
  | 'human_hand'
  | 'human_mouth'
export type AiTaskResultCode =
  | 'ok'
  | 'failed'
  | 'workspace_required'
  | 'approval_denied'
  | 'invalid_input'
export type HumanStepAction =
  | 'brain_decision'
  | 'learn_skill'
  | 'call_tool'
  | 'deliver_result'
  | 'block_result'
export type HumanStepResultStatus = 'ok' | 'error' | 'blocked'
export type WatchHintSource = 'learning' | 'hand' | 'memory_reducer'

export type AiRuntimeSettings = Record<string, never>

export type AiFileArtifactCapability = 'terminal_exec' | 'docx'
export type AiFileArtifactOperation = 'created' | 'updated'
export type AiFileArtifactRole = DraftArtifactRole
export type AiFileArtifactRef = {
  kind: 'file'
  capability: AiFileArtifactCapability
  path: string
  fileName: string
  operation: AiFileArtifactOperation
  artifactRole?: AiFileArtifactRole
  reviewId?: string
  draftDocumentId?: string
  draftSnapshotId?: string
  summary: string
}
export type AiDraftSnapshotRef = {
  reviewId?: string
  draftDocumentId?: string
  draftSnapshotId: string
  format?: DraftDocumentFormat
  sourcePath?: string
}
export type AiDraftReviewRef = {
  reviewId: string
  documentCount: number
  changeCount: number
}
export type AiDraftReviewArtifactRef = {
  kind: 'draft_review'
  review: AiDraftReviewRef
  summary: string
}
export type AiArtifactRef = AiFileArtifactRef | AiDraftReviewArtifactRef

export type AiPlanTask = {
  id: string
  title: string
  userInput: string
  status: AiTaskStatus
  deliveryMarkdown?: string
  artifacts?: AiArtifactRef[]
}

export type AiRunStartRequest = {
  sessionId: string
  input: string
  selectedDocumentIds?: string[]
  selectedSourceScopes?: SourceScopeSelection[]
  workspace?: WorkspaceRuntimeBinding
  allowNonLocal?: boolean
}

export type AiRunStartResponse = {
  success: boolean
  runId?: string
  error?: string
}

export type AiRunCancelResponse = {
  success: boolean
  error?: string
}

export type AiRunApprovalDecisionRequest = {
  runId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export type AiRunApprovalDecisionResponse = {
  success: boolean
  error?: string
}

type AiRunEventPayload =
  | {
      type: 'run_started'
      runId: string
      sessionId: string
      createdAt: number
      input: string
    }
  | {
      type: 'plan_created'
      runId: string
      plan: AiPlanTask[]
    }
  | {
      type: 'task_started'
      runId: string
      taskId: string
    }
  | {
      type: 'task_completed'
      runId: string
      taskId: string
    }
  | {
      type: 'task_delivery_ready'
      runId: string
      taskId: string
      summary: string
      deliveryMarkdown: string
      createdAt: number
    }
  | {
      type: 'task_blocked'
      runId: string
      taskId: string
      summary: string
    }
  | {
      type: 'tool_call_started'
      runId: string
      taskId?: string
      toolCallId: string
      toolName: string
      input: IpcJsonObject
      createdAt: number
    }
  | {
      type: 'tool_call_result'
      runId: string
      taskId?: string
      toolCallId: string
      toolName: string
      outputPreview: IpcJsonValue
      draftRef?: AiDraftSnapshotRef
      completedAt: number
      error?: string
    }
  | {
      type: 'terminal_step_started'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      cwd: string
      createdAt: number
    }
  | {
      type: 'terminal_step_result'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      outputPreview: string
      exitCode: number | null
      timedOut: boolean
      truncated: boolean
      completedAt: number
    }
  | {
      type: 'terminal_step_error'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      error: string
      outputPreview?: string
      completedAt: number
    }
  | {
      type: 'activity'
      runId: string
      taskId?: string
      activityId: string
      actionType: string
      status: 'started' | 'completed' | 'failed'
      summary: string
      createdAt: number
    }
  | {
      type: 'human_step'
      runId: string
      taskId: string
      stepIndex: number
      action: HumanStepAction
      skillId?: RuntimeSkillId
      toolName?: string
      publicNarrative: string
      learnedSkillIds: RuntimeSkillId[]
      availableToolNames: string[]
      resultStatus?: HumanStepResultStatus
      summary: string
      draftRef?: AiDraftSnapshotRef
      createdAt: number
    }
  | {
      type: 'watch_hint'
      runId: string
      taskId?: string
      source: WatchHintSource
      summary: string
      createdAt: number
    }
  | {
      type: 'file_artifact'
      runId: string
      taskId: string
      artifactId: string
      capability: AiFileArtifactCapability
      path: string
      fileName: string
      operation: AiFileArtifactOperation
      artifactRole?: AiFileArtifactRole
      reviewId?: string
      draftDocumentId?: string
      draftSnapshotId?: string
      summary: string
      stepId?: string
      createdAt: number
    }
  | {
      type: 'draft_review_ready'
      runId: string
      review: AiDraftReviewRef
      createdAt: number
    }
  | {
      type: 'workspace_required'
      runId: string
      taskId: string
      reason: string
      requiredFields: Array<'workspaceId' | 'rootPath'>
      createdAt: number
    }
  | {
      type: 'approval_required'
      runId: string
      taskId: string
      approvalId: string
      command: string
      riskLevel: 'medium' | 'high'
      reason: string
      createdAt: number
    }
  | {
      type: 'approval_decision'
      runId: string
      taskId: string
      approvalId: string
      approved: boolean
      reason?: string
      decidedAt: number
    }
  | {
      type: 'answer_token'
      runId: string
      taskId?: string
      token: string
    }
  | {
      type: 'answer_completed'
      runId: string
      taskId?: string
      text: string
    }
  | {
      type: 'runtime_issue'
      runId: string
      code: RuntimeIssueCode
      message: string
      taskId?: string
      workspaceId?: string
      scopeSourceId?: string
      createdAt: number
    }
  | {
      type: 'run_completed'
      runId: string
    }
  | {
      type: 'run_failed'
      runId: string
      error: string
    }
  | {
      type: 'run_cancelled'
      runId: string
    }

export type AiRunEvent = AiRunEventPayload & {
  internal?: boolean
  stage?: AiRunEventStage
}

export type ChatSessionMemory = {
  summary: string
  openTasks: string[]
  userPrefs: string[]
  pinnedFacts: string[]
  linkedDocumentIds: string[]
}

export type ChatSessionMemoryRow = {
  session_id: string
  memory_json: string
  updated_at: number
}
