import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type {
  AiPlanTask,
  AiRunEvent,
  AiRunEventStage,
  AiRunStatus,
  AiTaskStatus,
  BrainStepAction,
  CapabilityResult,
  HumanTaskInput,
  HumanTaskOutput,
  JsonObject,
  LLMConfig
} from '../../../shared/types'

export type { AiTaskStatus, AiRunStatus, AiPlanTask }
export type { BrainStepAction, CapabilityResult, HumanTaskInput, HumanTaskOutput }

export type AiMainStage =
  | 'main_intent'
  | 'main_context_enrich'
  | 'main_plan'
  | 'main_plan_exec'
  | 'main_finalize'

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
  // 最终答复文本（finalize 输出）。
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
  }) => Promise<{ recentTurnsText: string; sessionSummaryText: string }>
  getModelConfig: () => Promise<LLMConfig>
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}
