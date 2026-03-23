import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { DocxChangedBlock, DocxOp } from './human/tools/docx/types'
import type { DraftReviewService } from './human/tools/docx/review/DraftReviewService'
import type { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiRuntimeSettings,
  AiPlanTask,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiTaskStatus,
  LLMConfig,
  SourceScopeSelection
} from '../../../shared/types'
import type { HumanDeliveryMode, HumanTaskInput, HumanTaskOutput } from './human/types'
import {
  aiDirectorStageSchema,
  aiRunStateContractSchema,
  directorStatusSchema,
  planTaskStatusSchema
} from './schema'

export type { AiTaskStatus, AiRunStatus, AiPlanTask }
export type { HumanDeliveryMode, HumanTaskInput, HumanTaskOutput }

export type DirectorStatus = z.infer<typeof directorStatusSchema>
export type AiDirectorStage = z.infer<typeof aiDirectorStageSchema>
export type PlanTaskStatus = z.infer<typeof planTaskStatusSchema>

export type HumanRunDispatchOptions = {
  deliveryMode?: HumanDeliveryMode
  streamAnswer?: boolean
  internalDelivery?: boolean
}

export type CancelledError = Error & { code: 'CANCELLED' }

export type HumanTaskRunner = (
  taskInput: HumanTaskInput,
  options?: HumanRunDispatchOptions
) => Promise<HumanTaskOutput>

export type AiRunState = z.infer<typeof aiRunStateContractSchema>

export type AiRunStartPayload = {
  runId: string
  sessionId: string
  input: string
  selectedDocumentIds?: string[]
  selectedSourceScopes?: SourceScopeSelection[]
  allowNonLocal?: boolean
  workspace?: {
    workspaceId: string
    rootPath: string
    policyProfile?: string
  }
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
  draftReviewService: DraftReviewService
  isCancelled: () => boolean
  sendEvent: (event: AiRunEvent) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
}

export type AiRunContext = {
  runId: string
  sessionId: string
  selectedDocumentIds?: string[]
  selectedSourceScopes?: SourceScopeSelection[]
  selectedScopeSummary: string
  allowNonLocal: boolean
  runtimeSettings: AiRuntimeSettings
  humanRuntimeOverrides?: {
    hardActionLimit?: number
  }
  workspace?: {
    workspaceId: string
    rootPath: string
    policyProfile?: string
  }
  checkCancelled: () => void
  chatStructured: <T extends Record<string, unknown>>(input: {
    caller: string
    system: string
    user: string
    schema: z.ZodType<T>
    schemaName: string
    temperature?: number
  }) => Promise<T>
  sendEvent: (event: AiRunEvent) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
  loadHistory: (limits?: {
    recentTurns?: number
    maxRecentTurnsChars?: number
    maxSummaryChars?: number
  }) => Promise<{ recentTurnsText: string; sessionSummaryText: string }>
  trackDocxOpen: (input: { docId: string; sourcePath: string }) => void
  trackDocxChanges: (input: {
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
  }) => void
  trackDocxPreview: (input: { docId: string; previewPath: string }) => void
  getModelConfig: () => Promise<LLMConfig>
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}
