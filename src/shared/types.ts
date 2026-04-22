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
export type ReferenceKind = 'directory' | 'file' | 'web'
export type KbAvailability = 'indexed' | 'partial' | 'not_indexed'
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type IpcJsonPrimitive = JsonPrimitive
export type IpcJsonObject = object
export type IpcJsonArray = IpcJsonValue[]
export type IpcJsonValue = IpcJsonPrimitive | IpcJsonObject | IpcJsonArray

export interface WebIngestPayload {
  workspaceId: string
  url: string
  includeSelectors?: string[]
  excludeSelectors?: string[]
}

export interface DocumentRecord {
  id: string
  name: string
  source_type: DocumentSourceType
  workspace_id?: string
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
  workspace_id: string
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
  workspaceName: string
  rootPath: string
  policyProfile?: string
}

export interface DirectoryReference {
  kind: 'directory'
  workspaceId: string
  nodeId: string
  name: string
  relativePath: string
  absolutePath: string
  kbDocumentIds: string[]
  kbAvailability: KbAvailability
  indexedFileCount: number
  notIndexedFileCount: number
}

export interface FileReference {
  kind: 'file'
  workspaceId: string
  nodeId: string
  name: string
  relativePath: string
  absolutePath: string
  fileExt?: string
  kbDocumentIds: string[]
  kbAvailability: KbAvailability
}

export interface WebReference {
  kind: 'web'
  workspaceId: string
  webSourceId: string
  name: string
  url: string
  kbDocumentIds: string[]
  kbAvailability: KbAvailability
}

export type SelectedReference = DirectoryReference | FileReference | WebReference

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

export interface ReferenceItemListResponse {
  items: SelectedReference[]
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

export interface PickDirectoryResponse {
  canceled: boolean
  path?: string
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
  workspaceId: string
  webSourceId: string
}

export interface DeleteWebSourceRequest {
  workspaceId: string
  webSourceId: string
}

export interface ListWebSourcesRequest {
  workspaceId: string
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

export interface ListReferenceItemsRequest {
  query?: string
  mode: 'chat' | 'search'
  workspaceId?: string
  referenceKinds?: ReferenceKind[]
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

export type AiStructuredOutputTransport = 'completions' | 'responses'
export type AiStructuredOutputMethod = 'jsonSchema' | 'jsonMode' | 'promptJson' | 'scripted'
export type AiLlmStreamingMode = 'force_stream' | 'force_non_stream'
export type PreferredStructuredOutputProfile =
  | 'completions:jsonSchema'
  | 'completions:jsonMode'
  | 'completions:promptJson'
  | 'responses:jsonSchema'
  | 'responses:promptJson'
export type AiStructuredOutputProfile = PreferredStructuredOutputProfile | 'scripted'

export interface LLMConfig {
  id: string
  name: string
  base_url: string
  model_name: string
  api_key: string
  is_active: boolean
  preferredStructuredOutputProfile?: PreferredStructuredOutputProfile
  preferredTransport?: AiStructuredOutputTransport
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
export type FileReviewRenderKind =
  | 'docx_block'
  | 'text_hunk'
  | 'sheet_range'
  | 'slide_element'
  | 'preview_only'
export type DraftChangeDecision = 'pending' | 'accepted' | 'rejected'
export type DraftChangeResolution = Exclude<DraftChangeDecision, 'pending'>
export type FileReviewStatus =
  | 'pending_confirm'
  | 'committing'
  | 'committed'
  | 'conflicted'
  | 'discarded'
  | 'superseded'
  | 'failed'
export type DraftArtifactRole = 'draft' | 'committed'
export type CommitAttemptStatus = 'pending' | 'running' | 'completed' | 'failed' | 'conflicted'
export type CommitValidationIssueCode =
  | 'source_changed'
  | 'session_not_found'
  | 'session_not_ready'
  | 'review_artifact_missing'
  | 'working_artifact_missing'
  | 'committed_artifact_missing'
  | 'review_artifact_locked'

export interface DraftSourceVersion {
  mtime_ms?: number
  byte_size?: number
  checksum?: string
  content_hash?: string
}

/**
 * FileReview is the single-file review envelope shared by supported file editors.
 * Only docx is implemented today. Future xlsx/pptx support should reuse this
 * outer shape while keeping format-specific change generation and commit rules
 * inside each file subsystem.
 */
export interface FileReview {
  id: string
  session_id: string
  run_id: string
  status: FileReviewStatus
  title: string
  source_document_id?: string
  source_path: string
  source_name: string
  format: DraftDocumentFormat
  review_render_kind?: FileReviewRenderKind
  latest_draft_snapshot_id: string
  draft_artifact_path?: string
  working_artifact_path?: string
  committed_artifact_path?: string
  source_version: DraftSourceVersion
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

export interface FileReviewChange {
  id: string
  review_id: string
  order_index: number
  change_kind: DraftChangeKind
  title: string
  summary: string
  decision: DraftChangeDecision
  before_text?: string
  after_text?: string
  anchor_name?: string
  locator?: JsonObject
  diff_hunks?: DraftTextDiffHunk[]
  source_step_ref?: string
  metadata?: JsonObject
  created_at: number
  updated_at: number
}

export interface DraftTextDiffHunkLine {
  type: 'context' | 'added' | 'removed'
  value: string
}

export interface DraftTextDiffHunk {
  id: string
  title?: string
  summary?: string
  lines: DraftTextDiffHunkLine[]
}

export interface CommitResultItem {
  review_id: string
  output_path: string
  operation: AiFileArtifactOperation
  checksum?: string
  byte_size?: number
}

/**
 * CommitAttempt records submit-to-source executions for a FileReview.
 * It is lifecycle history, not change content.
 */
export interface CommitAttempt {
  id: string
  review_id: string
  status: CommitAttemptStatus
  results: CommitResultItem[]
  started_at: number
  completed_at?: number
  error?: string
}

export interface FileReviewDetail {
  review: FileReview
  changes: FileReviewChange[]
  commit_attempts: CommitAttempt[]
}

export interface ListFileReviewsRequest {
  sessionId?: string
  status?: FileReviewStatus
}

export interface ListFileReviewsResponse {
  items: FileReview[]
  total: number
}

export interface GetFileReviewRequest {
  reviewId: string
}

export interface GetFileReviewResponse {
  review?: FileReviewDetail
  error?: string
}

export interface CommitValidationIssue {
  code: CommitValidationIssueCode
  message: string
  sourcePath?: string
}

export interface ValidateFileReviewCommitRequest {
  reviewId: string
}

export interface ValidateFileReviewCommitResponse {
  ready: boolean
  issues: CommitValidationIssue[]
}

export interface CommitFileReviewRequest {
  reviewId: string
  overwrite?: boolean
}

export interface CommitFileReviewResponse {
  success: boolean
  job?: CommitAttempt
  error?: string
}

export interface DiscardFileReviewRequest {
  reviewId: string
}

export interface DiscardFileReviewResponse {
  success: boolean
  review?: FileReview
  error?: string
}

export interface RuntimeChangedFile {
  file_name: string
  source_path: string
  format: 'docx'
  change_count: number
  summary: string
  change_highlights: string[]
  draft_artifact_path?: string
}

export interface RuntimeArtifactsSummary {
  changed_files: RuntimeChangedFile[]
}

export interface PickApplicationResponse {
  canceled: boolean
  appPath?: string
  error?: string
}

export interface OpenPathWithApplicationRequest {
  filePath: string
  appPath: string
}

export interface OpenPathWithApplicationResponse {
  success: boolean
  error?: string
}

export type AiRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type RuntimeIssueCode =
  | 'workspace_binding_missing'
  | 'workspace_missing'
  | 'workspace_path_unavailable'
  | 'scope_unavailable'
  | 'approval_denied'
export type RuntimeSkillId =
  | 'history-recall'
  | 'workspace-cli'
  | 'docx-read'
  | 'docx-write'
  | 'kb-document-discovery'
  | 'kb-evidence-query'
export type AiRunEventStage =
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
export type AiToolCallDiagnostic = {
  message: string
}
export type AiToolResourceContext = {
  family: string
  sourcePath?: string
  currentRevisionRef?: string
  previousRevisionRef?: string
  effectKind?: string
}
export type AiToolCallResult = {
  toolName: string
  ok: boolean
  code: AiTaskResultCode
  data?: JsonValue
  diagnostic?: AiToolCallDiagnostic
  resourceContext?: AiToolResourceContext
}
export type AiLlmIoRecord = {
  callId: string
  runId: string
  taskId?: string
  caller: string
  schemaName: string
  model: string
  baseUrlHost: string
  system: string
  user: string
  output?: JsonValue
  rawText?: string
  method?: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain: AiStructuredOutputProfile[]
  streamingMode?: AiLlmStreamingMode
  streamed?: boolean
  chunkCount?: number
  firstTokenLatencyMs?: number
  startedAt: number
  completedAt: number
  durationMs: number
  status: 'completed' | 'failed'
  reason?: string
}
export type HumanStepAction = 'brain_decision' | 'learn_skill' | 'call_tool' | 'deliver_result'
export type HumanStepResultStatus = 'ok' | 'error'
export type WatchHintSource = 'brain' | 'learning' | 'hand' | 'memory_reducer'

export type AiRuntimeSettings = {
  llmStreamingMode: AiLlmStreamingMode
}

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
  draftSnapshotId?: string
  summary: string
}
export type AiDraftSnapshotRef = {
  reviewId?: string
  draftSnapshotId: string
  format?: DraftDocumentFormat
  sourcePath?: string
}
export type AiFileReviewRef = {
  reviewId: string
  changeCount: number
}
export type AiFileReviewArtifactRef = {
  kind: 'draft_review'
  review: AiFileReviewRef
  summary: string
}
export type AiArtifactRef = AiFileArtifactRef | AiFileReviewArtifactRef

export type AiRunStartRequest = {
  sessionId: string
  input: string
  selectedReferences?: SelectedReference[]
  modelConfigId?: string
  workspace?: WorkspaceRuntimeBinding
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

export interface AiActivityDetails {
  callId?: string
  caller?: string
  schemaName?: string
  model?: string
  baseUrlHost?: string
  attempt?: number
  durationMs?: number
  method?: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain?: AiStructuredOutputProfile[]
  streamingMode?: AiLlmStreamingMode
  streamed?: boolean
  chunkCount?: number
  firstTokenLatencyMs?: number
  reason?: string
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
      result?: AiToolCallResult
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
      details?: AiActivityDetails
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
      effectiveSkillIds: RuntimeSkillId[]
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
      code: string
      detail?: JsonObject
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
      draftSnapshotId?: string
      summary: string
      stepId?: string
      createdAt: number
    }
  | {
      type: 'draft_review_ready'
      runId: string
      review: AiFileReviewRef
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
      type: 'llm_stream_delta'
      runId: string
      taskId?: string
      callId: string
      caller: string
      chunkIndex: number
      text: string
      createdAt: number
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
