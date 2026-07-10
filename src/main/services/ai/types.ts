import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { AiLlmDriver } from './llmExecutor'
import type { WebCrawlerService } from '../webCrawler/types'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxOp,
  DocxReplaySession
} from './human/tools/docx/types'
import type { DocxApplyService } from './human/tools/docx/review/DocxApplyService'
import type { ResolvedDocxOpenTarget } from './human/tools/docx/review/types'
import type { z } from 'zod/v4'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AiLlmIoRecord,
  AiLlmStreamingMode,
  AiLlmUsage,
  AiRunFailureCode,
  AiRuntimeSettings,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiFileChangeRecord,
  ChatAttachment,
  BrainContextBudgetSnapshot,
  ChatConversationMemory,
  ChatSessionResumeSnapshot,
  DocxApplyRecord,
  SelectedReference
} from '../../../shared/types'
import type { LlmRuntimeConfig } from '../../../shared/types'
import type { HumanState, HumanTaskInput, HumanTaskOutput } from './human/types'
import { aiRunStateContractSchema, aiRunStatusSchema } from './schema'

export type { AiRunStatus, HumanTaskInput, HumanTaskOutput }

export type AiRunStateStatus = z.infer<typeof aiRunStatusSchema>

export type HumanRunDispatchOptions = {
  emitAnswerEvents?: boolean
  initialState?: HumanState
}

export type CancelledError = Error & { code: 'CANCELLED' }

export type HumanTaskRunner = (
  taskInput: HumanTaskInput,
  options?: HumanRunDispatchOptions
) => Promise<HumanTaskOutput>

export type AiRunState = z.infer<typeof aiRunStateContractSchema>

export type HumanResumeSnapshot = Pick<HumanState, 'memory' | 'skills'> & {
  execution: Pick<
    HumanState['execution'],
    'pendingDecisionHint' | 'deliveryGuidanceItems' | 'artifacts' | 'brainSchemaRetryCount'
  >
}

export type RecoverableRunErrorCode = Extract<AiRunFailureCode, 'timeout' | 'network_error'>

export type RecoverableHumanRunError = Error & {
  code: 'RECOVERABLE_HUMAN_RUN'
  reason: RecoverableRunErrorCode
  lastHumanState?: HumanState
}

export type AiRuntimePlatform = 'macos' | 'windows'

export type AiRunStartPayload = {
  runId: string
  sessionId: string
  input: string
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  mainModel?: {
    configId: string
    modelName: string
  }
  visionModel?: {
    configId: string
    modelName: string
  }
  workspace?: {
    workspaceId: string
    workspaceName: string
    rootPath: string
    policyProfile?: string
  }
}

export type AiWorkspaceBinding = NonNullable<AiRunStartPayload['workspace']>

export type AiReferenceScope = {
  workspace: AiWorkspaceBinding
  selectedReferences: SelectedReference[]
  attachments: ChatAttachment[]
}

export type AiApprovalBatchRequest = {
  runId: string
  taskId: string
  batchId: string
  items: AiApprovalBatchItem[]
  internal?: boolean
  stage?: AiRunEventStage
}

export type AiApprovalBatchResult =
  | {
      accepted: true
      decisions: AiApprovalBatchDecision[]
    }
  | {
      accepted: false
      error: string
    }

export type AiTerminalApprovalFallback = {
  runId: string
  taskId: string
  command: string
  reason: string
  internal?: boolean
  stage?: AiRunEventStage
}

export type BrowserUseAction = 'extract' | 'observe' | 'act'

export type BrowserUseActionItem = {
  description: string
  method?: string
}

export type BrowserUseResult =
  | {
      action: 'extract'
      url: string
      title?: string
      summary?: string
      content: string
    }
  | {
      action: 'observe'
      url: string
      title?: string
      summary?: string
      actions: BrowserUseActionItem[]
    }
  | {
      action: 'act'
      url: string
      title?: string
      summary?: string
      success: boolean
      message: string
      pageState?: string
    }

export type BrowserUseService = {
  show: () => Promise<void>
  navigate: (url: string) => Promise<void>
  run: (input: {
    action: BrowserUseAction
    instruction: string
    url?: string
    llmConfig: LlmRuntimeConfig
  }) => Promise<BrowserUseResult>
}

export type AiRunDeps = {
  runtimeSettings: AiRuntimeSettings
  llmStore: LlmConfigStore
  chatStore: ChatStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  ensureEmbeddingReady: () => Promise<void>
  docxApplyService: DocxApplyService
  saveFileChangeRecord: (record: AiFileChangeRecord) => Promise<void>
  listFileChangeRecords: (input: { runId: string }) => Promise<AiFileChangeRecord[]>
  isCancelled: () => boolean
  abortSignal?: AbortSignal
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>
  llmDriver?: AiLlmDriver
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
}

export type AiRunContext = {
  runId: string
  sessionId: string
  platform: AiRuntimePlatform
  referenceScope: AiReferenceScope
  allowedToolNames?: string[]
  humanRuntimeOverrides?: {
    hardActionLimit?: number
    modelContextWindowTokens?: number
  }
  workspace?: {
    workspaceId: string
    workspaceName: string
    rootPath: string
    policyProfile?: string
  }
  checkCancelled: () => void
  chatStructured: <T extends Record<string, unknown>>(input: {
    caller: string
    taskId?: string
    system: string
    user: string
    schema: z.ZodType<T>
    schemaName: string
    temperature?: number
    streamingMode?: AiLlmStreamingMode
    contextBudgetSnapshot?: BrainContextBudgetSnapshot
  }) => Promise<{
    output: T
    usage?: AiLlmUsage
  }>
  chatText: (input: {
    caller: string
    taskId?: string
    system: string
    user: string
    schemaName: string
    temperature?: number
    streamingMode?: AiLlmStreamingMode
    onTextDelta?: (text: string) => void
  }) => Promise<string>
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>
  getLlmConfig: () => Promise<LlmRuntimeConfig>
  getVisionLlmConfig: () => Promise<LlmRuntimeConfig>
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
  loadConversationContext: () => Promise<{
    recentTurnsText: string
    conversationSummaryText: string
  }>
  loadConversationMemory: () => Promise<ChatConversationMemory | null>
  trackDocxOpen: (input: {
    docId: string
    sourcePath: string
    replaySession?: DocxReplaySession
  }) => void
  trackDocxChanges: (input: {
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
    createdBlocks: DocxCreatedBlock[]
    replaySession?: DocxReplaySession
  }) => void
  trackDocxBatchChanges: (input: {
    previousDocId: string
    nextDocId: string
    ops: DocxOp[]
    changedBlocks: DocxChangedBlock[]
    createdBlocks: DocxCreatedBlock[]
    replaySession?: DocxReplaySession
  }) => void
  resolveDocxOpenTarget: (sourcePath: string) => Promise<ResolvedDocxOpenTarget>
  beginDocxApplyRun: () => void
  applyDocxRunEdits: () => Promise<DocxApplyRecord[]>
  discardDocxApplyRun: () => void
  saveFileChangeRecord: (record: AiFileChangeRecord) => Promise<void>
  listFileChangeRecords: (input: { runId: string }) => Promise<AiFileChangeRecord[]>
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}

export type AiRunFailureMetadata = {
  failureCode?: AiRunFailureCode
  resumeHumanState?: HumanState
  resumeSnapshotSaved?: boolean
}

export type ChatSessionResumeSnapshotRecord = ChatSessionResumeSnapshot

export type AiEventDispatchContext = Pick<AiRunContext, 'runId' | 'sendEvent' | 'recordLlmIo'>

export type TerminalToolContext = Pick<
  AiRunContext,
  | 'runId'
  | 'platform'
  | 'checkCancelled'
  | 'sendEvent'
  | 'requestApprovalBatch'
  | 'humanRuntimeOverrides'
  | 'saveFileChangeRecord'
>

export type KnowledgeRetrievalContext = Pick<
  AiRunContext,
  'runId' | 'checkCancelled' | 'sendEvent' | 'workspace' | 'documentsStore' | 'embeddingService'
>

export type DocxToolContext = Pick<
  AiRunContext,
  | 'runId'
  | 'checkCancelled'
  | 'sendEvent'
  | 'trackDocxOpen'
  | 'trackDocxChanges'
  | 'trackDocxBatchChanges'
  | 'resolveDocxOpenTarget'
  | 'embeddingService'
>
