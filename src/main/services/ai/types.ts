import type { ChatStore } from '../storage/domains/ChatStore'
import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type {
  AiLlmDriver,
  AiLlmTextMessagesRequest,
  AiLlmToolCallRequest,
  AiLlmToolCallResult
} from './llmExecutor'
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
  AiExecutionPermission,
  AiPreference,
  AiRunFailureCode,
  AiRunResumeSnapshotReason,
  AiRuntimeSettings,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiFileChangeRecord,
  ChatAttachment,
  BrainContextBudgetSnapshot,
  ChatSessionResumeSnapshot,
  ChatSessionSkillState,
  ChatMessageLogEntry,
  DocxApplyRecord,
  SelectedReference,
  WorkbenchSelectedModel
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
  schemaVersion: 3
  execution: Pick<HumanState['execution'], 'deliveryGuidanceItems' | 'artifacts' | 'finalizationReason'>
}

export type RecoverableRunErrorCode = AiRunResumeSnapshotReason

export type RecoverableHumanRunError = Error & {
  code: 'RECOVERABLE_HUMAN_RUN'
  reason: RecoverableRunErrorCode
  lastHumanState?: HumanState
}

export type AiRuntimePlatform = 'macos' | 'windows'

export type AiRunStartPayload = {
  runId: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  input: string
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  mainModel?: WorkbenchSelectedModel
  visionModel?: WorkbenchSelectedModel
  preference?: AiPreference
  executionPermission?: AiExecutionPermission
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

export type BrowserUseAction = 'navigate' | 'extract' | 'observe' | 'act'

export type BrowserUsePage = {
  url: string
  title?: string
}

export type BrowserActionCandidate = {
  description: string
  method?: string
  arguments?: string[]
}

export type BrowserUseActResult = {
  success: boolean
  message: string
  actionDescription: string
  actions: BrowserActionCandidate[]
}

export type BrowserUseResult =
  | {
      action: 'navigate'
      page: BrowserUsePage
      result: null
    }
  | {
      action: 'extract'
      page: BrowserUsePage
      result: {
        extracted: string
      }
    }
  | {
      action: 'observe'
      page: BrowserUsePage
      result: {
        actions: BrowserActionCandidate[]
      }
    }
  | {
      action: 'act'
      page: BrowserUsePage
      result: BrowserUseActResult
    }
  | {
      action?: BrowserUseAction
      page?: BrowserUsePage
      error: string
    }

export type BrowserUseRunRequest =
  | {
      tabId: string
      action: 'navigate'
      url: string
      instruction?: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'extract' | 'observe' | 'act'
      instruction: string
      llmConfig: LlmRuntimeConfig
    }

export type BrowserUseService = {
  ensureAutomationTab: (ownerId: string) => Promise<{ id: string }>
  navigate: (url: string, tabId?: string) => Promise<void>
  run: (input: BrowserUseRunRequest) => Promise<BrowserUseResult>
}

export type TerminalCommandChangeTrackingInput = {
  commandId: string
  runId: string
  sessionId: string
  workspaceRootPath: string
  command: string
}

export type AiRunDeps = {
  runtimeSettings: AiRuntimeSettings
  llmStore: LlmConfigStore
  chatStore: ChatStore
  chatMessageLogStore: ChatMessageLogStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  ensureEmbeddingReady: () => Promise<void>
  docxApplyService: DocxApplyService
  saveFileChangeRecord: (record: AiFileChangeRecord, workspaceRootPath?: string) => Promise<void>
  listFileChangeRecords: (input: { runId: string }) => Promise<AiFileChangeRecord[]>
  beginTerminalCommandTracking: (input: TerminalCommandChangeTrackingInput) => Promise<void>
  finishTerminalCommandTracking: (commandId: string) => Promise<AiFileChangeRecord[]>
  discardTerminalCommandTracking: (commandId: string) => void
  isCancelled: () => boolean
  abortSignal?: AbortSignal
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>
  llmDriver?: AiLlmDriver
  chatToolsWrapper?: (real: AiRunContext['chatTools']) => AiRunContext['chatTools']
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
  humanRuntimeOverrides?: {
    graphRecursionLimit?: number
    modelContextWindowTokens?: number
    terminalEnvironment?: Record<string, string>
  }
}

export type AiRunContext = {
  runId: string
  sessionId: string
  runStartedAt: number
  platform: AiRuntimePlatform
  preference: AiPreference
  executionPermission: AiExecutionPermission
  referenceScope: AiReferenceScope
  humanRuntimeOverrides?: {
    graphRecursionLimit?: number
    modelContextWindowTokens?: number
    terminalEnvironment?: Record<string, string>
  }
  workspace?: {
    workspaceId: string
    workspaceName: string
    rootPath: string
    policyProfile?: string
  }
  checkCancelled: () => void
  saveResumeSnapshot: (input: {
    reason: AiRunResumeSnapshotReason
    humanState: HumanState
    errorMessage?: string
  }) => Promise<void>
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
  chatMessages: (input: AiLlmTextMessagesRequest) => Promise<string>
  chatTools: (input: AiLlmToolCallRequest) => Promise<AiLlmToolCallResult>
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>
  getLlmConfig: () => Promise<LlmRuntimeConfig>
  getVisionLlmConfig: () => Promise<LlmRuntimeConfig>
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
  appendMessageLog: (entries: ChatMessageLogEntry[]) => Promise<void>
  loadMessageLog: () => Promise<ChatMessageLogEntry[]>
  loadSessionSkillState: () => Promise<ChatSessionSkillState>
  saveSessionSkillState: (input: {
    expectedRevision: number
    learnedSkillIds: string[]
  }) => Promise<ChatSessionSkillState>
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
  beginTerminalCommandTracking: (input: TerminalCommandChangeTrackingInput) => Promise<void>
  finishTerminalCommandTracking: (commandId: string) => Promise<AiFileChangeRecord[]>
  discardTerminalCommandTracking: (commandId: string) => void
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
  | 'beginTerminalCommandTracking'
  | 'finishTerminalCommandTracking'
  | 'discardTerminalCommandTracking'
>

export type KnowledgeRetrievalContext = Pick<
  AiRunContext,
  'runId' | 'checkCancelled' | 'sendEvent' | 'workspace' | 'documentsStore' | 'embeddingService'
>

export type DocxToolContext = AiRunContext
