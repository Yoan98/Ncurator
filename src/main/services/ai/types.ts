import type { PartnerStore } from '../storage/domains/PartnerStore'
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
import type { DocxEditSession } from './human/tools/docx/types'
import type { DocxApplyService } from './human/tools/docx/review/DocxApplyService'
import type { ResolvedDocxOpenTarget } from './human/tools/docx/review/types'
import type { z } from 'zod/v4'
import type {
  AiApprovalBatchDecision,
  AiApprovalBatchItem,
  AskUserQuestionInput,
  AskUserQuestionResult,
  AiLlmIoRecord,
  AiLlmStreamingMode,
  AiLlmUsage,
  AiExecutionPermission,
  AiPreference,
  AiRunFailureCode,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiFileChangeRecord,
  ChatAttachment,
  ChatMessageContentNode,
  BrainContextBudgetSnapshot,
  ChatMessageLogEntry,
  ChatMessageLogRecord,
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

export type AiRuntimePlatform = 'macos' | 'windows'

export type AiRunStartPayload = {
  ownerRunId?: string
  parentToolCallId?: string
  runId: string
  partnerId: string
  partnerName: string
  userMessageId: string
  assistantMessageId: string
  input: string
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
  contentNodes?: ChatMessageContentNode[]
  mainModel?: WorkbenchSelectedModel
  preference?: AiPreference
  executionPermission?: AiExecutionPermission
  workspaceRoots: string[]
}

export type AiWorkspaceBinding = {
  workspaceId: string
  workspaceName: string
  rootPath: string
  policyProfile?: string
}

export type AiReferenceScope = {
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

export type BrowserUseAction =
  | 'navigate'
  | 'list_tabs'
  | 'extract'
  | 'observe'
  | 'act'
  | 'act_instruction'
  | 'screenshot'
  | 'scroll'

export type BrowserUsePage = {
  url: string
  title?: string
}

/** Stagehand Action 原样字段 + 工具层分配的 actionId */
export type BrowserActionCandidate = {
  actionId: string
  description: string
  method: string
  arguments: string[]
  selector: string
}

export type BrowserUseTabItem = {
  tabId: string
  title: string
  url: string
  active: boolean
}

/** 供确定性 act 回放的 Stagehand Action（不含 actionId） */
export type BrowserStagehandAction = {
  description: string
  method: string
  arguments: string[]
  selector: string
}

export type BrowserUseActResult = {
  success: boolean
  message: string
  actionDescription: string
  executed: BrowserActionCandidate
}

export type BrowserUseScrollResult = {
  message: string
  scrolledPixels: number
}

export type BrowserUseResult =
  | {
      action: 'navigate'
      tabId: string
      page: BrowserUsePage
      result: null
    }
  | {
      action: 'list_tabs'
      tabs: BrowserUseTabItem[]
      result: null
    }
  | {
      action: 'extract'
      tabId: string
      page: BrowserUsePage
      result: {
        extracted: string
      }
    }
  | {
      action: 'observe'
      tabId: string
      page: BrowserUsePage
      result: {
        /** 尚未分配 actionId 的 Stagehand 候选，由工具层补齐 */
        actions: BrowserStagehandAction[]
      }
    }
  | {
      action: 'act'
      tabId: string
      page: BrowserUsePage
      result: BrowserUseActResult
    }
  | {
      action: 'act_instruction'
      tabId: string
      page: BrowserUsePage
      result: {
        success: boolean
        message: string
        actionDescription: string
      }
    }
  | {
      action: 'screenshot'
      tabId: string
      page: BrowserUsePage
      result: {
        path: string
      }
    }
  | {
      action: 'scroll'
      tabId: string
      page: BrowserUsePage
      result: BrowserUseScrollResult
    }
  | {
      action?: BrowserUseAction
      tabId?: string
      page?: BrowserUsePage
      error: string
    }

export type BrowserUseRunRequest = (
  | {
      tabId?: string
      ownerId: string
      action: 'navigate'
      url: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      ownerId: string
      action: 'list_tabs'
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'extract' | 'observe'
      instruction: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'act'
      stagehandAction: BrowserStagehandAction
      actionId: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'act_instruction'
      instruction: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'screenshot'
      screenshotPath: string
      llmConfig: LlmRuntimeConfig
    }
  | {
      tabId: string
      action: 'scroll'
      direction?: 'down' | 'up'
      percentage?: number
      llmConfig: LlmRuntimeConfig
    }
) & {
  abortSignal?: AbortSignal
  runId?: string
  executionScope?: string
  background?: boolean
}

export type BrowserUseService = {
  createTab: (ownerId: string) => Promise<{ id: string }>
  ensureAutomationTab: (ownerId: string) => Promise<{ id: string }>
  getActiveTabId: () => string | null
  listTabs: (ownerId: string) => Array<{ id: string; title?: string; url: string }>
  navigate: (url: string, tabId?: string) => Promise<void>
  run: (input: BrowserUseRunRequest) => Promise<BrowserUseResult>
  releaseRun?: (runId: string) => Promise<void>
}

export type AiTranscript = {
  append: (entries: ChatMessageLogEntry[], options?: { runId?: string }) => Promise<void>
  load: () => Promise<ChatMessageLogRecord[]>
}

export type SubagentTask = { name: string; task: string }

export type AiRunDeps = {
  modelConfig?: LlmRuntimeConfig
  transcript?: AiTranscript
  delegateToSubagent?: (
    tasks: SubagentTask[],
    toolCallId: string
  ) => Promise<import('../../../shared/types').SubagentUpdate[]>
  releaseRun?: (runId: string) => Promise<void>
  defaultStreamingMode?: AiLlmStreamingMode
  llmStore: LlmConfigStore
  partnerStore: PartnerStore
  chatMessageLogStore: ChatMessageLogStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  ensureEmbeddingReady: () => Promise<void>
  hasRunningKnowledgeIndexJob?: () => Promise<boolean>
  docxApplyService: DocxApplyService
  saveFileChangeRecord: (record: AiFileChangeRecord) => Promise<void>
  listFileChangeRecords: (input: {
    runId: string
    participatingOnly?: boolean
  }) => Promise<AiFileChangeRecord[]>
  isCancelled: () => boolean
  hasPendingUserMessages?: () => boolean
  waitForPendingUserMessageSubmissions?: () => Promise<void>
  abortSignal?: AbortSignal
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>
  requestUserQuestion?: (request: {
    taskId: string
    interactionId: string
    toolCallId: string
    questions: AskUserQuestionInput['questions']
    stage?: AiRunEventStage
  }) => Promise<
    { accepted: true; result: AskUserQuestionResult } | { accepted: false; error: string }
  >
  llmDriver?: AiLlmDriver
  chatToolsWrapper?: (real: AiRunContext['chatTools']) => AiRunContext['chatTools']
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
  scheduledTaskService?: import('../scheduler/ScheduledTaskService').ScheduledTaskService
  humanRuntimeOverrides?: {
    graphRecursionLimit?: number
    modelContextWindowTokens?: number
    terminalEnvironment?: Record<string, string>
  }
}

export type AiRunContext = {
  ownerRunId: string
  isSubagent: boolean
  delegateToSubagent: (
    tasks: SubagentTask[],
    toolCallId: string
  ) => Promise<import('../../../shared/types').SubagentUpdate[]>
  acquireFile: (sourcePath: string) => void
  runId: string
  partnerId: string
  userMessageId: string
  partnerName: string
  workspaceRoots: string[]
  runStartedAt: number
  platform: AiRuntimePlatform
  preference: AiPreference
  executionPermission: AiExecutionPermission
  contentNodes?: ChatMessageContentNode[]
  referenceScope: AiReferenceScope
  humanRuntimeOverrides?: {
    graphRecursionLimit?: number
    modelContextWindowTokens?: number
    terminalEnvironment?: Record<string, string>
  }
  workspace?: AiWorkspaceBinding
  checkCancelled: () => void
  hasPendingUserMessages: () => boolean
  waitForPendingUserMessageSubmissions: () => Promise<void>
  abortSignal?: AbortSignal
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
    retryOutputErrors?: boolean
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
  requestUserQuestion: (request: {
    taskId: string
    interactionId: string
    toolCallId: string
    questions: AskUserQuestionInput['questions']
    stage?: AiRunEventStage
  }) => Promise<
    { accepted: true; result: AskUserQuestionResult } | { accepted: false; error: string }
  >
  getLlmConfig: () => Promise<LlmRuntimeConfig>
  browserUseService?: BrowserUseService
  webCrawlerService?: WebCrawlerService
  scheduledTaskService?: import('../scheduler/ScheduledTaskService').ScheduledTaskService
  appendMessageLog: (entries: ChatMessageLogEntry[], options?: { runId?: string }) => Promise<void>
  loadMessageLog: () => Promise<ChatMessageLogRecord[]>
  trackDocxOpen: (input: {
    docId: string
    sourcePath: string
    editSession?: DocxEditSession
  }) => Promise<void>
  trackDocxChanges: (input: {
    previousDocId: string
    nextDocId: string
    editSession?: DocxEditSession
  }) => void
  resolveDocxOpenTarget: (sourcePath: string) => Promise<ResolvedDocxOpenTarget>
  beginDocxApplyRun: () => void
  applyDocxRunEdits: (options?: { retainState?: boolean }) => Promise<DocxApplyRecord[]>
  discardDocxApplyRun: () => void
  saveFileChangeRecord: (record: AiFileChangeRecord) => Promise<void>
  listFileChangeRecords: (input: {
    runId: string
    participatingOnly?: boolean
  }) => Promise<AiFileChangeRecord[]>
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  assertKbSearchAvailable: () => Promise<void>
}

export type AiRunFailureMetadata = {
  failureCode?: AiRunFailureCode
}

export type AiEventDispatchContext = Pick<
  AiRunContext,
  'runId' | 'sendEvent' | 'recordLlmIo' | 'abortSignal'
>

export type TerminalToolContext = Pick<
  AiRunContext,
  'runId' | 'platform' | 'checkCancelled' | 'sendEvent' | 'humanRuntimeOverrides'
>

export type KnowledgeRetrievalContext = Pick<
  AiRunContext,
  | 'runId'
  | 'checkCancelled'
  | 'sendEvent'
  | 'workspace'
  | 'documentsStore'
  | 'embeddingService'
  | 'assertKbSearchAvailable'
>

export type DocxToolContext = AiRunContext
