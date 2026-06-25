export type DocumentSourceType = 'file' | 'web'
export type DocumentImportStatus = 1 | 2 | 3
export type SearchSourceFilter = 'all' | DocumentSourceType
export type WebSourceIdentityKind = 'normalized_url'
export type WebSourceIndexStatus =
  | 'needs_index'
  | 'crawling'
  | 'crawl_failed'
  | 'indexing'
  | 'indexed'
  | 'index_failed'
export type WorkspaceNodeKind = 'directory' | 'file'
export type WorkspaceFileIndexStatus = 'needs_index' | 'indexing' | 'indexed' | 'failed'
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

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export type AppRuntimePlatform =
  | 'aix'
  | 'android'
  | 'cygwin'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'netbsd'
  | 'openbsd'
  | 'sunos'
  | 'win32'

export interface AppUpdateSnapshot {
  status: AppUpdateStatus
  currentVersion: string
  isPackaged: boolean
  updateSupported: boolean
  platform: AppRuntimePlatform
  availableVersion?: string
  releaseName?: string
  releaseDate?: string
  progressPercent?: number
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  error?: string
}

export interface AppUpdateActionResponse {
  success: boolean
  snapshot: AppUpdateSnapshot
  error?: string
}

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
  index_status: WebSourceIndexStatus
  include_selectors?: string[]
  exclude_selectors?: string[]
  fetched_at?: number
  last_checked_at?: number
  last_crawled_at?: number
  last_indexed_at?: number
  etag?: string
  last_modified?: string
  content_length?: number
  content_hash?: string
  last_error?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceSource {
  id: string
  name: string
  root_path?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceFileIndexRecord {
  id: string
  workspace_id: string
  relative_path: string
  absolute_path: string
  name: string
  file_ext: string
  size?: number
  mtime_ms?: number
  content_hash?: string
  index_status: WorkspaceFileIndexStatus
  document_id?: string
  indexed_at?: number
  last_checked_at?: number
  last_error?: string
  created_at: number
  updated_at: number
}

export interface WorkspaceTreeEntry {
  id: string
  workspace_id: string
  parent_id?: string
  kind: WorkspaceNodeKind
  name: string
  relative_path: string
  absolute_path: string
  file_ext?: string
  supported_for_index: boolean
  size?: number
  mtime_ms?: number
  index_status?: WorkspaceFileIndexStatus
  document_id?: string
  indexed_at?: number
  last_error?: string
}

export interface WorkspaceFileSummary {
  file_count: number
  indexed_file_count: number
  needs_index_count: number
  failed_file_count: number
}

export interface WorkspaceWebSummary {
  web_count: number
  needs_index_count: number
  failed_count: number
}

export interface WorkspaceListItem extends WorkspaceSource {
  file_count: number
  web_count: number
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
  phase: 'scan' | 'diff' | 'prepare' | 'inspect' | 'index' | 'complete'
  total: number
  completed: number
  added?: number
  updated?: number
  removed?: number
  failed?: number
  message?: string
}

export type WorkspaceIndexJobSourceKind = 'file' | 'web'
export type WorkspaceIndexJobAction = 'scan' | 'prepare'
export type WorkspaceIndexJobStatus = 'running' | 'succeeded' | 'failed'
export type WorkspaceIndexJobPhase = 'scan' | 'crawl' | 'index' | 'complete'

export interface WorkspaceIndexJobRecord {
  id: string
  workspace_id: string
  source_kind: WorkspaceIndexJobSourceKind
  action: WorkspaceIndexJobAction
  status: WorkspaceIndexJobStatus
  phase: WorkspaceIndexJobPhase
  step_index: number
  step_total: number
  total_count: number
  processed_count: number
  failed_count: number
  target_ids: string[]
  message?: string
  last_error?: string
  started_at: number
  updated_at: number
  finished_at?: number
}

export interface WorkspaceListResponse {
  items: WorkspaceListItem[]
  total: number
}

export interface WorkspaceTreeListResponse {
  items: WorkspaceTreeEntry[]
  total: number
  summary: WorkspaceFileSummary
}

export interface WorkspaceTreeNodeView {
  key: string
  title: string
  subtitle: string
  kind: WorkspaceNodeKind
  supportedForIndex: boolean
  indexStatus?: WorkspaceFileIndexStatus
  children?: WorkspaceTreeNodeView[]
}

export interface ReferenceItemListResponse {
  items: SelectedReference[]
  total: number
}

export interface WebSourceListResponse {
  items: WebSourceRecord[]
  total: number
  summary: WorkspaceWebSummary
}

export interface LegacyLocalImportMigrationStatus {
  hasLegacyLocalImports: boolean
  removedDocumentCount: number
  removedChunkCount: number
  migratedAt?: number
}

export interface CreateWorkspaceSourceRequest {
  name: string
}

export interface WorkspaceMutationResponse {
  success: boolean
  workspace?: WorkspaceSource
  error?: string
}

export interface SetWorkspaceRootPathRequest {
  workspaceId: string
  rootPath: string
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

export interface ScanWorkspaceRequest {
  workspaceId: string
}

export interface PrepareWorkspaceRequest {
  workspaceId: string
}

export interface ListWorkspaceTreeRequest {
  workspaceId: string
  includeUnsupported?: boolean
}

export interface WorkspaceJobResponse {
  success: boolean
  workspaceId?: string
  job?: WorkspaceIndexJobRecord
  progress?: WorkspaceSyncProgress
  error?: string
}

export interface WorkspaceIndexJobGetRequest {
  workspaceId: string
  sourceKind: WorkspaceIndexJobSourceKind
}

export interface WorkspaceIndexJobResponse {
  success: boolean
  job?: WorkspaceIndexJobRecord
  error?: string
}

export interface RefreshWebSourceRequest {
  workspaceId: string
  webSourceId: string
}

export interface ScanWebSourcesRequest {
  workspaceId: string
}

export interface PrepareWebSourcesRequest {
  workspaceId: string
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

export type ChatMessageContentNode =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'reference'
      reference: SelectedReference
    }

export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  contentNodes?: ChatMessageContentNode[]
  selectedReferences?: SelectedReference[]
  artifacts?: AiArtifactRef[]
  error?: boolean
}

export interface ChatSession {
  id: string
  title: string
  created_at: number
  workspace_id: string
}

export type AiFileChangeStatus = 'applied' | 'reverted' | 'failed'
export type AiFileChangeCapability = 'docx' | 'terminal_exec' | 'ppt'
export type AiFileChangeOperation = 'created' | 'updated'

export interface AiFileChangeRecord {
  id: string
  sessionId: string
  runId: string
  status: AiFileChangeStatus
  capability: AiFileChangeCapability
  path: string
  fileName: string
  operation: AiFileChangeOperation
  changeCount: number
  beforeSnapshotPath?: string
  beforeChecksum?: string
  afterChecksum?: string
  previewPath?: string
  createdAt: number
  updatedAt: number
  revertedAt?: number
  error?: string
}

export interface ListAiFileChangeRecordsRequest {
  sessionId?: string
  runId?: string
  status?: AiFileChangeStatus
}

export interface ListAiFileChangeRecordsResponse {
  items: AiFileChangeRecord[]
  total: number
}

export interface GetAiFileChangeRecordRequest {
  changeId: string
}

export interface GetAiFileChangeRecordResponse {
  record?: AiFileChangeRecord
  error?: string
}

export interface RevertAiFileChangeRequest {
  changeId: string
  force?: boolean
}

export interface RevertAiFileChangeResponse {
  success: boolean
  record?: AiFileChangeRecord
  requiresForce?: boolean
  warning?: string
  error?: string
}

export type DocxApplyStatus = AiFileChangeStatus

export interface DocxApplyRecord {
  id: string
  session_id: string
  run_id: string
  status: DocxApplyStatus
  source_path: string
  source_name: string
  operation: AiFileChangeOperation
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

export interface FileChangeSummaryItem {
  id: string
  fileName: string
  path: string
  capability: AiFileChangeCapability
  operation: AiFileChangeOperation
  changeCount: number
  status: AiFileChangeStatus
}

export interface FileChangesSummary {
  changed_files: FileChangeSummaryItem[]
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

export type AiRunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
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
  | 'web-browsing'
  | 'utility'
export type AiRunEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'
export type AssistantProcessDisplay =
  | { kind: 'thinking' }
  | { kind: 'learning'; skillId: RuntimeSkillId }
  | { kind: 'tool'; toolName: string; input: IpcJsonObject }
  | { kind: 'compaction' }
  | { kind: 'finalizing' }
export type AssistantProcessKind = 'thinking' | 'skill' | 'learning' | 'compaction' | 'finalizing'
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
export type AiFileArtifactOperation = AiFileChangeOperation
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

export type ChatSubmitMode = 'ai' | 'search'

export type ChatSubmitRequest = {
  mode: ChatSubmitMode
  sessionId: string
  input: string
  contentNodes?: ChatMessageContentNode[]
  selectedReferences?: SelectedReference[]
  modelName?: string
  workspace?: WorkspaceRuntimeBinding
  searchDocumentIds?: string[]
}

export type AiRunRecord = {
  id: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  status: AiRunStatus
  input: string
  selectedReferences?: SelectedReference[]
  workspace?: WorkspaceRuntimeBinding
  modelName?: string
  partialAnswer: string
  finalAnswer?: string
  error?: string
  pendingApproval?: Extract<AiRunEvent, { type: 'approval_batch_required' }>
  artifacts?: AiArtifactRef[]
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export type AiRunEventRecord = {
  id: string
  runId: string
  sessionId: string
  seq: number
  type: AiRunEvent['type']
  event: AiRunEvent
  createdAt: number
}

export type ChatSessionRunSnapshot = {
  run: AiRunRecord
  events: AiRunEvent[]
  pendingApproval?: Extract<AiRunEvent, { type: 'approval_batch_required' }>
}

export type ChatSessionSnapshotRequest = {
  sessionId: string
}

export type ChatSessionSnapshotResponse = {
  messages: ChatMessage[]
  runs?: ChatSessionRunSnapshot[]
  activeRuns: ChatSessionRunSnapshot[]
}

export type ChatSubmitResponse = {
  success: boolean
  mode?: ChatSubmitMode
  userMessage?: ChatMessage
  assistantMessage?: ChatMessage
  run?: AiRunRecord
  results?: SearchResult[]
  tokens?: string[]
  content?: string
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

export type BrowserPanelBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserPanelBoundsRequest = BrowserPanelBounds & {
  visible: boolean
}

export type BrowserPanelMutationResponse = {
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
      type: 'assistant_process_group_started'
      runId: string
      groupId: string
      kind: AssistantProcessKind
      display: AssistantProcessDisplay
      createdAt: number
    }
  | {
      type: 'assistant_process_group_completed'
      runId: string
      groupId: string
      display?: AssistantProcessDisplay
      completedAt: number
    }
  | {
      type: 'assistant_process_group_failed'
      runId: string
      groupId: string
      display?: AssistantProcessDisplay
      error?: string
      failedAt: number
    }
  | {
      type: 'assistant_process_item_started'
      runId: string
      groupId: string
      itemId: string
      display: AssistantProcessDisplay
      createdAt: number
    }
  | {
      type: 'assistant_process_item_completed'
      runId: string
      groupId: string
      itemId: string
      display?: AssistantProcessDisplay
      completedAt: number
    }
  | {
      type: 'assistant_process_item_failed'
      runId: string
      groupId: string
      itemId: string
      display?: AssistantProcessDisplay
      error?: string
      failedAt: number
    }
  | {
      type: 'assistant_process_thought'
      runId: string
      thoughtId: string
      text: string
      createdAt: number
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
      type: 'browser_panel_opened'
      runId: string
      taskId?: string
      createdAt: number
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
