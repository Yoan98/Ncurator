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
  unsupportedReason?: string
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

export type AppStartupStatus =
  | { mode: 'normal' }
  | {
      mode: 'update_required'
      databaseVersion: number
      supportedDatabaseVersion: number
      downloadPageUrl: string
    }

export interface WebIngestPayload {
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
  content_hash?: string
  active_generation_id?: string
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
  root_path: string
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
  root_kind: 'file' | 'directory'
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
export type WorkspaceIndexJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
export type WorkspaceIndexJobPhase = 'scan' | 'diff' | 'crawl' | 'index' | 'complete'

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
  hasMore: boolean
  offset: number
  limit: number
}

/** @ 候选单次拉取上限 */
export const REFERENCE_ITEM_PAGE_SIZE = 50

/** 相对工作地址根最多收录的路径深度（根=0，其下两级=2） */
export const REFERENCE_ITEM_MAX_PATH_DEPTH = 2

export interface ListReferenceItemsRequest {
  referenceKinds?: ReferenceKind[]
  query?: string
  offset?: number
  limit?: number
}

export interface WebSourceListResponse {
  items: WebSourceRecord[]
  total: number
  summary: WorkspaceWebSummary
}

export interface CreateWorkspaceSourceRequest {
  rootPath: string
}

export type WorkspaceRootConflictReason = 'exists' | 'nested' | 'contains'

export interface WorkspaceRootConflict {
  reason: WorkspaceRootConflictReason
  existingPaths: string[]
}

export interface WorkspaceMutationResponse {
  success: boolean
  workspace?: WorkspaceSource
  error?: string
  conflict?: WorkspaceRootConflict
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

export interface PickFileResponse {
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

export interface ListWorkspaceDirectoryRequest {
  workspaceId: string
  relativePath?: string
}

export interface WorkspaceDirectoryListResponse {
  items: WorkspaceTreeEntry[]
  total: number
  summary?: WorkspaceFileSummary
  error?: string
}

export interface WorkspaceJobResponse {
  success: boolean
  workspaceId?: string
  job?: WorkspaceIndexJobRecord
  progress?: WorkspaceSyncProgress
  error?: string
  cancelled?: boolean
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
  webSourceId: string
}

export interface ScanWebSourcesRequest {
  sourceKind?: 'web'
}

export interface PrepareWebSourcesRequest {
  sourceKind?: 'web'
}

export interface WorkspaceIndexCancelRequest {
  sourceKind: WorkspaceIndexJobSourceKind
}

export interface WorkspaceIndexPrepareSessionBeginRequest {
  sourceKind: WorkspaceIndexJobSourceKind
}

export interface DeleteWebSourceRequest {
  webSourceId: string
}

export type ListWebSourcesRequest = Record<string, never>

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

export interface SearchResult {
  id: string
  text: string
  document_name: string
  document_id?: string
  source_type?: string
  file_path?: string
  source_url?: string
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

export interface DocumentListResponse {
  items: DocumentRecord[]
  total: number
}

// Chat & LLM Types

export type AiLlmStreamingMode = 'force_stream' | 'force_non_stream'
export type KnowledgeIndexSpeed = 'slow' | 'fast'
export type EmbeddingServiceStatus = 'uninitialized' | 'initializing' | 'ready' | 'error'
export type EmbeddingRuntimeProcessInfo = {
  pid: number | null
  intraOpNumThreads: number
}
export type EmbeddingRuntimeSnapshot = EmbeddingRuntimeProcessInfo & {
  status: EmbeddingServiceStatus
}
export type LlmProviderKind = 'openai' | 'deepseek' | 'openai-compatible'
export type LlmProviderId =
  | 'deepseek'
  | 'dashscope'
  | 'mimo'
  | 'zhipu'
  | 'local'
  | 'custom'
export interface LLMConfig {
  id: string
  name: string
  providerKind: LlmProviderKind
  base_url: string
  api_key: string
}

export type WorkbenchSelectedModel = {
  configId: string
  modelName: string
}

export type WorkbenchModelSelection = {
  mainModel: WorkbenchSelectedModel | null
}

export type LlmRuntimeConfig = LLMConfig & {
  model_name: string
}

export type LlmRemoteModel = {
  id: string
  label?: string
  status?: string
  inputModalities?: string[]
  outputModalities?: string[]
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

export type ChatAttachmentKind = 'image' | 'file'
export type ChatAttachmentStatus = 'ready' | 'processing' | 'failed'

export type ChatAttachment = {
  id: string
  kind: ChatAttachmentKind
  name: string
  path: string
  mimeType?: string
  size?: number
  status: ChatAttachmentStatus
  error?: string
}

export type AttachmentPickRequest = {
  partnerId: string
  assetBucketId: string
}

export type AttachmentPickResponse = {
  canceled: boolean
  items: ChatAttachment[]
  error?: string
}

export type AttachmentProcessResponse = {
  success: boolean
  attachment?: ChatAttachment
  error?: string
}

export type AttachmentCreateFromPathRequest = {
  sourcePath: string
  mimeType?: string
  kind?: ChatAttachmentKind
}

export type AttachmentSaveRequest = {
  partnerId: string
  assetBucketId: string
  name: string
  bytes: Uint8Array
  mimeType?: string
  kind?: ChatAttachmentKind
}

export type MarkdownLinkAccessStatus = 'accessible' | 'unavailable'
export type MarkdownLinkResourceType = 'file' | 'web'

/** Sidecar for assistant delivery links; body markdown is never rewritten. */
export type MarkdownLinkAccessEntry = {
  href: string
  resourceType: MarkdownLinkResourceType
  accessStatus: MarkdownLinkAccessStatus
}

export interface ChatMessage {
  id: string
  partner_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  contentNodes?: ChatMessageContentNode[]
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  artifacts?: AiArtifactRef[]
  /** Present on delivery assistant messages after finalizeDelivery access checks. */
  linkAccess?: MarkdownLinkAccessEntry[]
  error?: boolean
}

export const PARTNER_AVATAR_SHAPES = [
  'circle',
  'rounded_square',
  'pill',
  'hexagon',
  'cloud',
  'teardrop'
] as const
export type PartnerAvatarShape = (typeof PARTNER_AVATAR_SHAPES)[number]

export const PARTNER_AVATAR_COLORS = [
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'light_grey',
  'dark_grey'
] as const
export type PartnerAvatarColor = (typeof PARTNER_AVATAR_COLORS)[number]

export interface Partner {
  id: string
  name: string
  avatar_shape: PartnerAvatarShape
  avatar_color: PartnerAvatarColor
  pinned: boolean
  pinned_at: number | null
  created_at: number
  updated_at: number
  last_viewed_at: number
}

export interface PartnerListItem extends Partner {
  isRunning: boolean
  hasUnreadCompletion: boolean
  lastUserMessagePreview: string | null
  lastActivityAt: number
}

export type PartnerCreateRequest = {
  name: string
  avatar_shape: PartnerAvatarShape
  avatar_color: PartnerAvatarColor
}

export type PartnerCreateResponse = {
  success: boolean
  partner?: Partner
  error?: string
}

export type PartnerUpdateRequest = {
  id: string
  name: string
  avatar_shape: PartnerAvatarShape
  avatar_color: PartnerAvatarColor
}

export type PartnerUpdateResponse = PartnerCreateResponse

export type PartnerSetPinnedRequest = {
  id: string
  pinned: boolean
}

export type PartnerClearContextRequest = {
  partnerId: string
}

export type PartnerClearContextResponse = {
  success: boolean
  error?: string
  clearedAt?: number
}

export type PartnerUiFileRef = {
  path: string
  fileName: string
  origin: 'search_hit' | 'read' | 'artifact' | 'preview' | 'source'
  summary?: string
  applyId?: string
  format?: 'docx' | 'pptx'
  pageNumber?: number
  isDirectory?: boolean
}

export type PartnerUiPanelState =
  | { kind: 'empty'; title: string; description: string }
  | {
      kind: 'file_preview'
      title: string
      file: PartnerUiFileRef
      backTarget?: PartnerUiPanelState
    }
  | { kind: 'file_launcher'; title: string }
  | { kind: 'apply_workspace'; title: string; applyId: string | null }
  | { kind: 'browser'; title: string; browserTabId: string }

export type PartnerUiResourceTab = {
  id: string
  kind: 'file' | 'browser'
  title: string
  filePath?: string
  browserTabId?: string
  state: Extract<
    PartnerUiPanelState,
    { kind: 'file_preview' | 'file_launcher' | 'apply_workspace' | 'browser' }
  >
}

export type PartnerUiStateV1 = {
  version: 1
  composer: {
    aiPreference: AiPreference
    executionPermission: AiExecutionPermission
    modelSelection: WorkbenchModelSelection
    draft: {
      input: string
      contentNodes: ChatMessageContentNode[]
      selectedReferences: SelectedReference[]
      attachments: ChatAttachment[]
      assetBucketId: string | null
    }
  }
  panel: {
    tabs: PartnerUiResourceTab[]
    activeTabId: string | null
    collapsed: boolean
    fallbackState: PartnerUiPanelState
  }
}

export type PartnerUiStateSaveRequest = {
  partnerId: string
  state: PartnerUiStateV1
}

export type PartnerUiStateSaveResponse = {
  success: boolean
  updatedAt?: number
  error?: string
}

export type WorkbenchUiState = {
  activeViewKey: string | null
  updatedAt: number
}

export type WorkbenchUiStateSaveRequest = {
  activeViewKey: string | null
}

export type WorkbenchUiStateResponse = {
  success: boolean
  state: WorkbenchUiState
  error?: string
}

export interface FileWatchStartRequest {
  filePath: string
}

export interface FileWatchStartResponse {
  success: boolean
  watchId?: string
  filePath?: string
  error?: string
}

export interface FileWatchMutationRequest {
  watchId: string
}

export interface FileWatchCheckResponse {
  success: boolean
  changed: boolean
  error?: string
}

export interface FileWatchStopResponse {
  success: boolean
  error?: string
}

export interface FileWatchChangeEvent {
  watchId: string
  filePath: string
}

export interface WriteTextFileRequest {
  filePath: string
  content: string
  /** 载入时的文件 SHA-256。提供时用于检测外部冲突：磁盘内容与载入时不同则拒绝覆盖。 */
  expectedHash?: string
}

export interface WriteTextFileResponse {
  success: boolean
  error?: string
  /** 磁盘内容与 expectedHash 不一致时返回 true，表示需要用户确认后再覆盖。 */
  conflict?: boolean
  /** 写入后的文件 SHA-256。 */
  hash?: string
}

export type AiFileChangeStatus = 'applied' | 'reverted' | 'failed'
export type AiFileChangeCapability = 'docx' | 'text_file' | 'ppt' | 'excel' | 'image'
export type AiFileChangeOperation = 'created' | 'updated' | 'deleted' | 'renamed'
export type AiFileChangeSource =
  | 'text_tool'
  | 'docx_tool'
  | 'ppt_tool'
  | 'excel_tool'
  | 'image_tool'

export type TextFileDiffLine =
  | { type: 'context'; oldLine: number; newLine: number; text: string }
  | { type: 'remove'; oldLine: number; text: string }
  | { type: 'add'; newLine: number; text: string }

export interface TextFileDiffHunk {
  oldStart: number
  newStart: number
  lines: TextFileDiffLine[]
}

export interface TextFileDiffArtifact {
  version: 2
  oldLineCount: number
  newLineCount: number
  hunks: TextFileDiffHunk[]
}

export interface AiFileChangeRecord {
  id: string
  partnerId: string
  runId: string
  status: AiFileChangeStatus
  capability: AiFileChangeCapability
  path: string
  fileName: string
  operation: AiFileChangeOperation
  source?: AiFileChangeSource
  beforePath?: string
  afterPath?: string
  changeCount: number
  insertCount: number
  deleteCount: number
  beforeSnapshotPath?: string
  afterSnapshotPath?: string
  beforeObjectHash?: string
  afterObjectHash?: string
  previewArtifactHash?: string
  beforeChecksum?: string
  afterChecksum?: string
  previewPath?: string
  runSummary?: string
  createdAt: number
  updatedAt: number
  revertedAt?: number
  error?: string
}

export interface ListAiFileChangeRecordsRequest {
  partnerId?: string
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
  partner_id: string
  run_id: string
  status: DocxApplyStatus
  source_path: string
  source_name: string
  operation: AiFileChangeOperation
  final_revision_ref: string
  change_count: number
  insert_count: number
  delete_count: number
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
  partnerId?: string
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
  insertCount: number
  deleteCount: number
  status: AiFileChangeStatus
}

export interface FileChangesSummary {
  changed_files: FileChangeSummaryItem[]
}

export interface OpenWithApplication {
  id: string
  name: string
  iconDataUrl?: string
  isDefault: boolean
}

export interface ListOpenWithApplicationsRequest {
  filePath: string
}

export interface ListOpenWithApplicationsResponse {
  success: boolean
  applications: OpenWithApplication[]
  defaultApplicationId?: string
  error?: string
}

export interface OpenFileWithApplicationRequest {
  filePath: string
  applicationId: string
}

export interface OpenFileWithApplicationResponse {
  success: boolean
  error?: string
}

export type AiRunStatus = 'running' | 'waiting_human' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
export type AiRunWarningCode =
  | 'workspace_binding_missing'
  | 'workspace_missing'
  | 'workspace_path_unavailable'
  | 'scope_unavailable'
  | 'approval_denied'
  | 'llm_usage_unavailable'
export type RuntimeIssueCode = AiRunWarningCode
export type RuntimeSkillId = RegisteredRuntimeSkillId
export type AiRunEventStage = 'human_brain' | 'human_learning' | 'human_plan' | 'human_hand'
export type AssistantProcessDisplay =
  | { kind: 'thinking' }
  | { kind: 'learning'; skillId: RuntimeSkillId }
  | { kind: 'tool'; toolName: string; input: IpcJsonObject }
  | { kind: 'retry'; attempt: number; maxAttempts: number; message: string }
  | { kind: 'compaction' }
  | { kind: 'finalizing' }
export type AssistantProcessKind =
  | 'thinking'
  | 'skill'
  | 'learning'
  | 'retry'
  | 'compaction'
  | 'finalizing'
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
  resourceContext?: AiToolResourceContext
}
export type BrainContextBudgetSnapshot = {
  evaluationId: string
  basis: 'initial' | 'usage_plus_delta' | 'post_compaction' | 'usage_unavailable'
  budgetTokens: number
  contextWindowTokens: number
  hasCompressibleHistory: boolean
  usageAvailable: boolean
  lastBrainInputTokens?: number
  deltaTokenEstimate?: number
}

export type ContextCompactionHistoryFloorKind = 'compaction' | 'none'

export type ContextCompactionCut = {
  throughSeq: number
  firstKeptSeq?: number
  historyFloorSeq: number
  historyFloorKind: ContextCompactionHistoryFloorKind
  isSplitTurn: boolean
  foldedCount: number
  tailCount: number
}
export type AiLlmRequestWireToolCall = {
  id: string
  name: string
  arguments: string
}

export type AiLlmRequestWireMessage = {
  role: string
  content: string
  toolCalls?: AiLlmRequestWireToolCall[]
  toolCallId?: string
}

export type AiLlmRequestWireTool = {
  name: string
  description: string
  parameters: JsonValue
}

export type AiLlmRequestWire = {
  messages: AiLlmRequestWireMessage[]
  tools: AiLlmRequestWireTool[]
  messagesHash: string
  toolsHash: string
}

export type AiLlmRequestWireDiff = {
  equal: boolean
  firstPath: string
  leftPreview: string
  rightPreview: string
  toolsHashEqual: boolean
  messagesHashEqual: boolean
  firstDifferingToolIndex?: number
  firstDifferingMessageIndex?: number
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
  requestWire?: AiLlmRequestWire
  output?: JsonValue
  rawText?: string
  usage?: AiLlmUsage
  stablePrefixHash?: string
  dynamicContextHash?: string
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
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

export type AppSettings = {
  systemNotificationsEnabled: boolean
  knowledgeIndexSpeed: KnowledgeIndexSpeed
}

export type AiFileArtifactCapability = 'docx' | 'ppt' | 'excel' | 'text_file' | 'image'
export type AiFileArtifactOperation = AiFileChangeOperation
export type AiFileArtifactRef = {
  kind: 'file'
  capability: AiFileArtifactCapability
  path: string
  fileName: string
  operation: AiFileArtifactOperation
  applyId?: string
}
export type AiDraftSnapshotRef = {
  draftSnapshotId: string
  format?: 'docx' | 'pptx'
  sourcePath?: string
}
export type AiArtifactRef = AiFileArtifactRef

export type AiPreference = 'default' | 'local_sources_relaxed' | 'local_sources_strict'
export type AiExecutionPermission = 'review' | 'full_access'

export type UserQuestionOption = {
  id: string
  label: string
  description?: string
  recommended?: boolean
}

export type UserQuestion = {
  id: string
  question: string
  options: UserQuestionOption[]
  multiSelect?: boolean
}

export type AskUserQuestionInput = { questions: UserQuestion[] }

export type AskUserQuestionAnswer = {
  id: string
  selected: string[]
  custom?: string
}

export type AskUserQuestionResult = { answers: AskUserQuestionAnswer[] }

export type PendingHumanInteraction =
  | {
      kind: 'question'
      interactionId: string
      toolCallId: string
      questions: UserQuestion[]
    }
  | {
      kind: 'approval'
      interactionId: string
      items: AiApprovalBatchItem[]
      batchId?: string
    }

export type AiRunHumanInteractionRequest = {
  runId: string
  interactionId: string
  answers: AskUserQuestionResult
}

export type AiRunHumanInteractionResponse = { success: boolean; error?: string }

export type ChatSubmitRequest = {
  preference?: AiPreference
  executionPermission?: AiExecutionPermission
  partnerId: string
  input: string
  contentNodes?: ChatMessageContentNode[]
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  mainModel?: WorkbenchSelectedModel
}

export type ScheduledTaskScheduleType = 'daily' | 'weekly'

export type ScheduledTask = {
  id: string
  name: string
  prompt: string
  enabled: boolean
  scheduleType: ScheduledTaskScheduleType
  timeOfDay: string
  weekday: number | null
  partnerId: string
  mainModel: WorkbenchSelectedModel
  aiPreference: AiPreference
  executionPermission: AiExecutionPermission
  nextRunAt: number | null
  /** 到点因专属伙伴占用而取消本次时写入；关闭胶囊或立即执行成功后清空 */
  busyCancelNoticeAt: number | null
  createdAt: number
  updatedAt: number
}

export type ScheduledTaskSaveRequest = {
  id?: string
  name: string
  prompt: string
  scheduleType: ScheduledTaskScheduleType
  timeOfDay: string
  weekday?: number | null
  mainModel: WorkbenchSelectedModel
  aiPreference?: AiPreference
  executionPermission?: AiExecutionPermission
}

export type ScheduledTaskMutationResponse = {
  success: boolean
  task?: ScheduledTask
  error?: string
}

export type ScheduledTaskSetEnabledRequest = {
  id: string
  enabled: boolean
}

export type ScheduledTaskRunNowRequest = {
  id: string
}

export type ScheduledTaskDismissBusyNoticeRequest = {
  id: string
}

export type AiRunRecord = {
  id: string
  partnerId: string
  userMessageId: string
  assistantMessageId: string
  status: AiRunStatus
  input: string
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  modelName?: string
  mainModel?: WorkbenchSelectedModel
  preference?: AiPreference
  executionPermission?: AiExecutionPermission
  partialAnswer: string
  partialAnswerRole?: 'answer' | 'thought'
  finalAnswer?: string
  error?: string
  failureCode?: AiRunFailureCode
  failureRawMessage?: string
  pendingApproval?: Extract<AiRunEvent, { type: 'approval_batch_required' }>
  pendingInteraction?: PendingHumanInteraction
  artifacts?: AiArtifactRef[]
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

export type PartnerRunSnapshot = {
  run: AiRunRecord
  messageLogRecords?: ChatMessageLogRecord[]
  pendingApproval?: Extract<AiRunEvent, { type: 'approval_batch_required' }>
  pendingInteraction?: PendingHumanInteraction
}

export type PartnerSnapshotRequest = {
  partnerId: string
}

export type PartnerSnapshotResponse = {
  messages: ChatMessage[]
  runs?: PartnerRunSnapshot[]
  activeRuns: PartnerRunSnapshot[]
}

export type PartnerOpenRequest = {
  partnerId: string
  limit?: number
  beforeTimestamp?: number
}

export type PartnerOpenResponse = {
  partner?: Partner
  messages: ChatMessage[]
  hasMoreBefore: boolean
  activeRuns: PartnerRunSnapshot[]
  uiState?: PartnerUiStateV1
}

export type PartnerRunSummariesRequest = {
  partnerId: string
}

export type PartnerRunSummariesResponse = {
  runs: PartnerRunSnapshot[]
}

export type ChatSubmitResponse = {
  success: boolean
  userMessage?: ChatMessage
  assistantMessage?: ChatMessage
  run?: AiRunRecord
  error?: string
}

export type ChatTurnRetractLatestRequest = {
  partnerId: string
  userMessageId: string
}

export type ChatTurnRetractLatestResponse = {
  success: boolean
  userMessage?: ChatMessage
  assistantMessageId?: string
  runId?: string
  messages: ChatMessage[]
  memoryCleared?: boolean
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
  commandExplanation: string
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
  tabId: string
  presentationId: number
}

/**
 * 右侧面板水平布局锚点：让主进程在窗口 resize 时同步（同进程、无 IPC 往返）重算原生浏览器 view 的 bounds，
 * 实现与窗口一起实时缩放，而不是等 renderer→IPC→main 的一拍延迟。仅在布局模型（比例/侧栏宽/挂载）变化时注册一次。
 */
export type BrowserPanelFollowRequest = {
  /** 主分栏容器左边界（= 侧栏宽度，窗口横向缩放时稳定） */
  splitLeft: number
  /** 主分栏右边界到窗口内容右缘的固定间距 */
  rightMargin: number
  /** 右侧面板占「中间+右侧」可分配宽度的比例 */
  ratio: number
  minWidth: number
  middleMin: number
  maxRatio: number
}

export type BrowserPanelShowRequest = {
  tabId: string
}

export type BrowserPanelHideRequest = {
  presentationId?: number
}

export type BrowserPanelMenuRequest = {
  tabId: string
  x: number
  y: number
}

export type BrowserResourceMenuAction = 'file' | 'browser'

export type BrowserResourceMenuRequest = {
  x: number
  y: number
}

export type BrowserPanelMutationResponse = {
  success: boolean
  error?: string
}

export type BrowserPanelPresentationResponse = BrowserPanelMutationResponse & {
  presentationId?: number
}

export type BrowserPanelCaptureResponse = BrowserPanelMutationResponse & {
  dataUrl?: string
}

export type BrowserTabState = {
  id: string
  ownerId: string
  url: string
  title?: string
  zoomPercent: number
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export type BrowserPanelStateResponse = BrowserPanelMutationResponse & {
  state?: BrowserTabState
}

export type BrowserTabListRequest = {
  ownerId: string
}

export type BrowserTabListResponse = BrowserPanelMutationResponse & {
  tabs: BrowserTabState[]
}

export type BrowserTabCreateRequest = {
  ownerId: string
}

export type BrowserTabMutationRequest = {
  tabId: string
}

export type BrowserTabNavigateRequest = BrowserTabMutationRequest & {
  url: string
}

export type BrowserTabCreateResponse = BrowserPanelStateResponse

export type AiContextUsageRequest = {
  partnerId: string
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
  streamingMode?: AiLlmStreamingMode
  streamed?: boolean
  chunkCount?: number
  firstTokenLatencyMs?: number
  usage?: AiLlmUsage
  responseMetadata?: JsonObject
  usageMetadata?: JsonObject
  reason?: string
}

export type AiRunFailureCode =
  | 'user_cancelled'
  | 'process_interrupted'
  | 'llm_request_failed'
  | 'output_truncated'
  | 'input_too_long'
  | 'runtime_limit'
  | 'internal_error'
  | 'unexpected_error'
export type AiRunFailureSource = 'provider' | 'internal'

type AiRunEventPayload =
  | {
      type: 'run_started'
      runId: string
      partnerId: string
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
      browserTabId: string
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
      executionStatus: 'completed' | 'cancelled'
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
      type: 'terminal_command_yielded'
      runId: string
      taskId: string
      terminalId: string
      commandId: string
      currentTerminalPath: string
      readEndPosition: number
      createdAt: number
    }
  | {
      type: 'terminal_command_stopped'
      runId: string
      taskId: string
      terminalId: string
      forced: boolean
      createdAt: number
    }
  | {
      type: 'terminal_session_closed'
      runId: string
      taskId: string
      terminalId: string
      createdAt: number
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
      type: 'file_artifact'
      runId: string
      taskId: string
      artifactId: string
      capability: AiFileArtifactCapability
      path: string
      fileName: string
      operation: AiFileArtifactOperation
      applyId?: string
      changeCount?: number
      insertCount?: number
      deleteCount?: number
      stepId?: string
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
      type: 'assistant_brain_stream_started'
      runId: string
      roundId: string
      createdAt: number
    }
  | {
      type: 'assistant_brain_stream_delta'
      runId: string
      roundId: string
      text: string
      createdAt: number
    }
  | {
      type: 'assistant_brain_stream_reset'
      runId: string
      roundId: string
      createdAt: number
    }
  | {
      type: 'assistant_brain_stream_classified'
      runId: string
      roundId: string
      role: 'thought'
      createdAt: number
    }
  | {
      type: 'assistant_brain_stream_completed'
      runId: string
      roundId: string
      role: 'thought' | 'answer'
      text: string
      completedAt: number
    }
  | {
      type: 'assistant_plan_updated'
      runId: string
      plan: ChatMessageLogPlanItem[]
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
      linkAccess?: MarkdownLinkAccessEntry[]
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
      targetMessageCount: number
      budgetTokensBefore: number
      thresholdTokens: number
      createdAt: number
      stage?: 'human_brain'
    } & ContextCompactionCut
  | {
      type: 'context_compaction_completed'
      runId: string
      taskId?: string
      compactBlockId: string
      sourceMessageCount: number
      tokenEstimateBefore: number
      sourceHistoryTokenEstimate: number
      tokenEstimateAfter: number
      summaryPreview: string
      completedAt: number
      stage?: 'human_brain'
    } & ContextCompactionCut
  | {
      type: 'run_warning'
      runId: string
      code: AiRunWarningCode
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
      source: AiRunFailureSource
      message: string
      rawMessage?: string
      httpStatus?: number
      providerCode?: string
      code?: AiRunFailureCode
    }
  | {
      type: 'run_cancelled'
      runId: string
    }
  | {
      type: 'human_interaction_required'
      runId: string
      taskId: string
      interactionId: string
      interaction: PendingHumanInteraction
      createdAt: number
      stage?: AiRunEventStage
    }
  | {
      type: 'human_interaction_resolved'
      runId: string
      taskId: string
      interactionId: string
      kind: 'question' | 'approval'
      result: JsonObject
      resolvedAt: number
      stage?: AiRunEventStage
    }

export type AiRunEvent = AiRunEventPayload & {
  internal?: boolean
  stage?: AiRunEventStage
}

export type ChatMessageLogToolCall = {
  id: string
  name: string
  args: IpcJsonObject
}

export type ChatMessageImageRef = {
  path: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

export type ChatMessageLogUserContext = {
  selectedReferences: SelectedReference[]
  attachments: ChatAttachment[]
}

export type ChatMessageLogPlanItem = {
  title: string
  status: 'todo' | 'done'
}

export type ChatMessageLogAnnotationEntry =
  | {
      kind: 'annotation'
      eventType: 'thinking_started' | 'thinking_completed' | 'finalizing_started'
      payload: JsonObject
    }
  | {
      kind: 'annotation'
      eventType: 'learning_started' | 'learning_completed'
      payload: { skillId: string }
    }
  | {
      kind: 'annotation'
      eventType: 'skill_state_updated'
      payload: { learnedSkillIds: string[] }
    }
  | {
      kind: 'annotation'
      eventType: 'plan_updated'
      payload: { plan: ChatMessageLogPlanItem[] }
    }
  | {
      kind: 'annotation'
      eventType: 'compaction_checkpoint'
      payload: {
        compactBlockId: string
        throughSeq: number
        sourceMessageCount: number
        summary: string
      }
    }
  | {
      kind: 'annotation'
      eventType: 'approval_batch_resolved'
      payload: {
        batchId: string
        items: Array<{
          toolCallId: string
          toolName: string
          command: string
          commandExplanation?: string
          action: 'approve' | 'reject' | 'guide'
          message?: string
        }>
      }
    }
  | {
      kind: 'annotation'
      eventType: 'human_interaction_resolved'
      payload: {
        interactionId: string
        kind: 'question' | 'approval'
        result: JsonObject
      }
    }

export type ChatMessageLogEntry =
  | {
      kind: 'user'
      content: string
      input: string
      context: ChatMessageLogUserContext
    }
  | {
      kind: 'assistant'
      content: string
      toolCalls: ChatMessageLogToolCall[]
      /** Delivery-only sidecar; process assistants omit this. */
      linkAccess?: MarkdownLinkAccessEntry[]
    }
  | {
      kind: 'tool'
      toolCallId: string
      toolName: string
      ok: boolean
      content: string
      images?: ChatMessageImageRef[]
    }
  | ChatMessageLogAnnotationEntry

export type ChatMessageLogRecord = {
  id: string
  partnerId: string
  runId: string
  seq: number
  entry: ChatMessageLogEntry
  createdAt: number
}

import type { RuntimeSkillId as RegisteredRuntimeSkillId } from './runtimeCapabilities'
