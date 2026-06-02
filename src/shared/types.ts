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
export type LlmProviderKind = 'openai' | 'deepseek' | 'openai-compatible'
export type PreferredStructuredOutputProfile =
  | 'completions:jsonSchema'
  | 'completions:jsonMode'
  | 'completions:promptJson'
  | 'responses:jsonSchema'
  | 'responses:promptJson'
export type AiStructuredOutputProfile = PreferredStructuredOutputProfile | 'scripted'

export interface LLMConfig {
  id: string
  providerKind: LlmProviderKind
  base_url: string
  api_key: string
  is_active: boolean
  default_model: string
}

export type LlmRuntimeConfig = LLMConfig & {
  model_name: string
  preferredStructuredOutputProfile?: PreferredStructuredOutputProfile
  preferredTransport?: AiStructuredOutputTransport
}

export type LlmRemoteModel = {
  id: string
  label?: string
}

export type LlmModelListResponse = {
  success: boolean
  items: LlmRemoteModel[]
  error?: string
}

export type AiLlmUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  cacheMissInputTokens?: number
  cacheWriteInputTokens?: number
  cacheHitRate?: number
  source: 'usage_metadata' | 'response_metadata' | 'unavailable'
  rawUsage?: JsonObject
}

export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  // JSON string of SearchResult[]
  sources?: string
  artifacts?: AiArtifactRef[]
  error?: boolean
}

export interface ChatSession {
  id: string
  title: string
  created_at: number
}

export type DocxApplyStatus = 'applied' | 'reverted' | 'failed'

export interface DocxApplyRecord {
  id: string
  session_id: string
  run_id: string
  status: DocxApplyStatus
  source_path: string
  source_name: string
  operation: AiFileArtifactOperation
  final_revision_ref: string
  change_count: number
  before_exists: boolean
  before_snapshot_path?: string
  before_checksum?: string
  before_byte_size?: number
  before_modified_at?: number
  preview_diff_artifact_path: string
  preview_diff_checksum: string
  preview_diff_byte_size: number
  after_checksum?: string
  after_byte_size?: number
  after_modified_at?: number
  created_at: number
  updated_at: number
  reverted_at?: number
  error?: string
}

export interface ListDocxApplyRecordsRequest {
  sessionId?: string
  status?: DocxApplyStatus
}

export interface ListDocxApplyRecordsResponse {
  items: DocxApplyRecord[]
  total: number
}

export interface GetDocxApplyRecordRequest {
  applyId: string
}

export interface GetDocxApplyRecordResponse {
  record?: DocxApplyRecord
  error?: string
}

export interface RevertDocxApplyRequest {
  applyId: string
  force?: boolean
}

export interface RevertDocxApplyResponse {
  success: boolean
  record?: DocxApplyRecord
  requiresForce?: boolean
  warning?: string
  error?: string
}

export interface RuntimeChangedFile {
  file_name: string
  source_path: string
  format: 'docx'
  change_count: number
  summary: string
  change_highlights: string[]
  apply_id?: string
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
  | 'llm_usage_unavailable'
export type RuntimeSkillId =
  | 'terminal'
  | 'docx-read'
  | 'docx-write'
  | 'kb-retrieval'
export type AiRunEventStage =
  | 'human_brain'
  | 'human_learning'
  | 'human_hand'
  | 'human_mouth'
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
  data?: JsonValue
  diagnostic?: AiToolCallDiagnostic
  resourceContext?: AiToolResourceContext
}
export type BrainContextBudgetSnapshot = {
  evaluationId: string
  basis: 'initial' | 'usage_plus_delta' | 'post_compaction' | 'usage_unavailable'
  budgetTokens: number
  contextWindowTokens: number
  compactionTriggerTokens: number
  hasCompressibleHistory: boolean
  usageAvailable: boolean
  lastBrainInputTokens?: number
  deltaTokenEstimate?: number
}
export type AiLlmIoRecord = {
  callId: string
  runId: string
  taskId?: string
  caller: string
  schemaName: string
  providerKind?: LlmProviderKind
  model: string
  baseUrlHost: string
  system: string
  user: string
  output?: JsonValue
  rawText?: string
  usage?: AiLlmUsage
  stablePrefixHash?: string
  dynamicContextHash?: string
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
  method?: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain: AiStructuredOutputProfile[]
  streamingMode?: AiLlmStreamingMode
  contextBudgetSnapshot?: BrainContextBudgetSnapshot
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
export type DecisionHintSource = 'brain' | 'learning' | 'hand' | 'memory_reducer'

export type AiRuntimeSettings = {
  llmStreamingMode: AiLlmStreamingMode
}

export type AiFileArtifactCapability = 'terminal_exec' | 'docx'
export type AiFileArtifactOperation = 'created' | 'updated'
export type AiFileArtifactRef = {
  kind: 'file'
  capability: AiFileArtifactCapability
  path: string
  fileName: string
  operation: AiFileArtifactOperation
  applyId?: string
  summary: string
}
export type AiDraftSnapshotRef = {
  draftSnapshotId: string
  format?: 'docx'
  sourcePath?: string
}
export type AiArtifactRef = AiFileArtifactRef

export type AiRunStartRequest = {
  sessionId: string
  input: string
  selectedReferences?: SelectedReference[]
  modelName?: string
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

export type AiApprovalBatchItem = {
  itemId: string
  order: number
  toolName: string
  command: string
  reason: string
}

export type AiApprovalBatchDecision = {
  itemId: string
  action: 'approve' | 'reject' | 'guide'
  message?: string
}

export type AiRunApprovalBatchDecisionRequest = {
  runId: string
  batchId: string
  decisions: AiApprovalBatchDecision[]
}

export type AiRunApprovalBatchDecisionResponse = {
  success: boolean
  error?: string
}

export type AiContextUsageRequest = {
  sessionId: string
}

export type AiContextUsageResponse = {
  success: boolean
  contextWindowTokens?: number
  usedContextTokens?: number
  ratio?: number
  updatedAt?: number
  error?: string
}

export interface AiActivityDetails {
  callId?: string
  caller?: string
  schemaName?: string
  providerKind?: LlmProviderKind
  model?: string
  baseUrlHost?: string
  attempt?: number
  stablePrefixHash?: string
  dynamicContextHash?: string
  durationMs?: number
  method?: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain?: AiStructuredOutputProfile[]
  streamingMode?: AiLlmStreamingMode
  streamed?: boolean
  chunkCount?: number
  firstTokenLatencyMs?: number
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
  reason?: string
}

export type AiRunFailureCode = 'timeout' | 'network_error' | 'error'

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
      cwd: string
      exitCode: number | null
      timedOut: boolean
      completedAt: number
    }
  | {
      type: 'terminal_step_error'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      cwd: string
      error: string
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
      type: 'decision_hint'
      runId: string
      taskId?: string
      source: DecisionHintSource
      code: string
      detail?: JsonObject
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
      applyId?: string
      summary: string
      stepId?: string
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
      type: 'approval_batch_required'
      runId: string
      taskId: string
      batchId: string
      items: AiApprovalBatchItem[]
      createdAt: number
    }
  | {
      type: 'approval_batch_decision'
      runId: string
      taskId: string
      batchId: string
      decisions: AiApprovalBatchDecision[]
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
      type: 'context_budget_evaluated'
      runId: string
      taskId?: string
      stage: 'human_brain'
      decision: 'continue' | 'compact'
      snapshot: BrainContextBudgetSnapshot
      createdAt: number
    }
  | {
      type: 'context_compaction_started'
      runId: string
      taskId?: string
      targetRoundIds: number[]
      budgetTokensBefore: number
      thresholdTokens: number
      createdAt: number
    }
  | {
      type: 'context_compaction_completed'
      runId: string
      taskId?: string
      compactBlockId: string
      sourceRoundIds: number[]
      tokenEstimateBefore: number
      sourceHistoryTokenEstimate: number
      tokenEstimateAfter: number
      summaryPreview: string
      completedAt: number
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
      code?: AiRunFailureCode
      resumeSnapshotSaved?: boolean
    }
  | {
      type: 'run_cancelled'
      runId: string
    }

export type AiRunEvent = AiRunEventPayload & {
  internal?: boolean
  stage?: AiRunEventStage
}

export type ChatConversationMemory = {
  summary: string
}

export type ChatConversationMemoryRow = {
  session_id: string
  memory_json: string
  updated_at: number
}

export type ChatSessionResumeSnapshot = {
  reason: Extract<AiRunFailureCode, 'timeout' | 'network_error'>
  runId: string
  userInput: string
  selectedReferences: SelectedReference[]
  workspace?: WorkspaceRuntimeBinding
  humanState: JsonObject
  errorMessage: string
  updatedAt: number
}

export type ChatSessionResumeSnapshotRow = {
  session_id: string
  run_id: string
  reason: string
  user_input: string
  selected_references_json: string
  workspace_json?: string
  human_state_json: string
  error_message: string
  updated_at: number
}
