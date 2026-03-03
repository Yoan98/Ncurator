import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type {
  AiPlanTask,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiSlotRef,
  AiTaskStatus,
  BrainStepAction,
  CapabilityResult,
  HumanTaskInput,
  HumanTaskOutput,
  JsonObject,
  JsonValue,
  LLMConfig
} from '../../../shared/types'

export type { AiTaskStatus, AiRunStatus, AiPlanTask }
export type { BrainStepAction, CapabilityResult, HumanTaskInput, HumanTaskOutput }

export type AiMainStage =
  | 'main_context_gate'
  | 'main_context_dispatch'
  | 'main_plan'
  | 'main_dispatch'
  | 'main_finalize'

export type AiContextDecision = 'need_context' | 'to_plan' | 'direct_finalize'

export type AiTaskSlotState = Record<AiSlotRef, JsonValue>

export type AiRunState = {
  runId: string
  sessionId: string
  status: AiRunStatus
  input: string
  mainStage: AiMainStage
  contextRounds: number
  contextDecision?: AiContextDecision
  contextEvidence: string[]
  directAnswerDraft?: string
  plan: AiPlanTask[]
  dispatchCursor: number
  taskSlots: Record<string, AiTaskSlotState>
  slotArtifacts: Record<string, JsonObject>
  humanStepIndex: number
  error?: string
  outputText?: string
}

export type AiRunStartPayload = {
  runId: string
  sessionId: string
  input: string
  selectedDocumentIds?: string[]
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
  llmStore: LlmConfigStore
  chatStore: ChatStore
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  isCancelled: () => boolean
  sendEvent: (event: AiRunEvent) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
}

export type AiRunContext = {
  runId: string
  sessionId: string
  selectedDocumentIds?: string[]
  workspace?: {
    workspaceId: string
    rootPath: string
    policyProfile?: string
  }
  checkCancelled: () => void
  chatJson: <T extends JsonObject = JsonObject>(input: {
    system: string
    user: string
    temperature?: number
  }) => Promise<T>
  sendEvent: (event: AiRunEvent) => void
  requestApproval: (request: AiApprovalRequest) => Promise<AiApprovalDecision>
  loadHistory: (limits?: {
    recentTurns?: number
    maxRecentTurnsChars?: number
    maxSummaryChars?: number
    maxLocalInstructionItems?: number
    maxLocalInstructionChars?: number
  }) => Promise<{ recentTurnsText: string; sessionSummaryText: string; localInstructions: string[] }>
  getModelConfig: () => Promise<LLMConfig>
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}
