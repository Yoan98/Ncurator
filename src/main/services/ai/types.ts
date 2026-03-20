import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type { DocxChangedBlock, DocxOp } from './human/tools/docx/types'
import type { DraftReviewService } from './human/tools/docx/review/DraftReviewService'
import type {
  AiRuntimeSettings,
  AiPlanTask,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiTaskStatus,
  JsonObject,
  LocalSourceUsageStatus,
  LLMConfig,
  SourceScopeSelection
} from '../../../shared/types'
import type { HumanTaskInput, HumanTaskOutput } from './human/types'

export type { AiTaskStatus, AiRunStatus, AiPlanTask }
export type { HumanTaskInput, HumanTaskOutput }

export type AiMainStage =
  | 'main_intent'
  | 'main_context_human'
  | 'main_plan'
  | 'main_plan_exec'
  | 'main_direct_human_exec'
  | 'main_synthesis_human'
  | 'main_complete'

export type HumanRunDispatchOptions = {
  streamAnswer?: boolean
  internalDelivery?: boolean
}

export type CancelledError = Error & { code: 'CANCELLED' }

export type HumanTaskRunner = (
  taskInput: HumanTaskInput,
  options?: HumanRunDispatchOptions
) => Promise<HumanTaskOutput>

export type AiRunState = {
  // 当前 run 的唯一标识，与事件流 runId 对齐。
  runId: string
  // 对话会话 ID，用于历史与消息写回。
  sessionId: string
  // run 生命周期状态（main 全局状态）。
  status: AiRunStatus
  // 用户本轮输入。
  input: string
  // main graph 路由阶段唯一来源。
  mainStage: AiMainStage
  // 已执行的上下文补充轮次。
  contextRounds: number
  // 本轮需要补充上下文时的人类可执行目标。
  contextObjective?: string
  // gate/context 过程沉淀的证据摘要。
  contextEvidence: string[]
  // main_plan 产出的任务列表。
  plan: AiPlanTask[]
  // main_plan_exec 串行游标。
  dispatchCursor: number
  // run 级错误原因（失败时填充）。
  error?: string
  // 最终交付 markdown（direct human / synthesis human 输出）。
  finalDeliveryMarkdown?: string
  // 产生最终交付的任务 ID。
  finalDeliveryTaskId?: string
  // 本地资料使用状态。
  localSourceStatus?: LocalSourceUsageStatus
  // 本地资料使用或不足说明。
  localSourceSummary?: string
}

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
