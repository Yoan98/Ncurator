import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { AiLlmDriver } from './llmExecutor'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxOp,
  DocxReplaySession
} from './human/tools/docx/types'
import type { FileReviewService } from './human/tools/docx/review/FileReviewService'
import type { ResolvedDocxOpenTarget } from './human/tools/docx/review/types'
import type { z } from 'zod/v4'
import type {
  AiLlmIoRecord,
  AiRuntimeSettings,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  FileReviewDetail,
  SelectedReference
} from '../../../shared/types'
import type { HumanTaskInput, HumanTaskOutput } from './human/types'
import { aiRunStateContractSchema, aiRunStatusSchema } from './schema'

export type { AiRunStatus, HumanTaskInput, HumanTaskOutput }

export type AiRunStateStatus = z.infer<typeof aiRunStatusSchema>

export type HumanRunDispatchOptions = {
  emitAnswerEvents?: boolean
}

export type CancelledError = Error & { code: 'CANCELLED' }

export type HumanTaskRunner = (
  taskInput: HumanTaskInput,
  options?: HumanRunDispatchOptions
) => Promise<HumanTaskOutput>

export type AiRunState = z.infer<typeof aiRunStateContractSchema>

export type AiRuntimePlatform = 'macos' | 'windows'

export type AiRunStartPayload = {
  runId: string
  sessionId: string
  input: string
  selectedReferences?: SelectedReference[]
  modelConfigId?: string
  workspace?: {
    workspaceId: string
    workspaceName: string
    rootPath: string
    policyProfile?: string
  }
}

export type AiWorkspaceBinding = NonNullable<AiRunStartPayload['workspace']>

export type AiReferenceScope = {
  workspace?: AiWorkspaceBinding
  selectedReferences: SelectedReference[]
  hasExplicitSelectedReferences: boolean
  hasDirectDocumentNarrowing: boolean
  defaultKnowledgeScope: 'current_workspace' | 'unavailable'
}

export type AiApprovalRequest = {
  runId: string
  taskId: string
  command: string
  riskLevel: 'medium' | 'high'
  reason: string
  internal?: boolean
  stage?: AiRunEventStage
}

export type AiApprovalDecision = {
  approved: boolean
  reason?: string
}

export type AiRunDeps = {
  runtimeSettings: AiRuntimeSettings
  llmStore: LlmConfigStore
  chatStore: ChatStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  ensureEmbeddingReady: () => Promise<void>
  fileReviewService: FileReviewService
  isCancelled: () => boolean
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
  llmDriver?: AiLlmDriver
}

export type AiRunContext = {
  runId: string
  platform: AiRuntimePlatform
  referenceScope: AiReferenceScope
  humanRuntimeOverrides?: {
    hardActionLimit?: number
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
  }) => Promise<T>
  chatText: (input: {
    caller: string
    taskId?: string
    system: string
    user: string
    schemaName: string
    temperature?: number
    onTextDelta?: (text: string) => void
  }) => Promise<string>
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
  loadHistory: (limits?: {
    recentTurns?: number
    maxRecentTurnsChars?: number
    maxSummaryChars?: number
  }) => Promise<{ recentTurnsText: string; sessionSummaryText: string }>
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
  resolveDocxOpenTarget: (sourcePath: string) => Promise<ResolvedDocxOpenTarget>
  beginDocxReviewRun: () => void
  finalizeDocxReviewRun: () => Promise<FileReviewDetail[]>
  discardDocxReviewRun: () => void
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}

export type AiEventDispatchContext = Pick<AiRunContext, 'runId' | 'sendEvent' | 'recordLlmIo'>

export type TerminalToolContext = Pick<
  AiRunContext,
  'runId' | 'checkCancelled' | 'sendEvent' | 'requestApproval'
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
  | 'requestApproval'
  | 'trackDocxOpen'
  | 'trackDocxChanges'
  | 'resolveDocxOpenTarget'
  | 'embeddingService'
>
