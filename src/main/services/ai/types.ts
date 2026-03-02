import type { ChatStore } from '../storage/domains/ChatStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import type { EmbeddingService } from '../vector/EmbeddingService'
import type {
  AiPlanTask,
  AiTaskKind,
  AiTaskStatus,
  AiRunEvent,
  AiRunStatus,
  JsonObject,
  LLMConfig
} from '../../../shared/types'

export type { AiTaskKind, AiTaskStatus, AiRunStatus, AiPlanTask }

export type AiRunState = {
  /** 当前 run 的唯一标识，用于事件流与状态回写关联。 */
  runId: string
  /** 当前会话 ID，用于读取历史消息与记忆。 */
  sessionId: string
  /** 整体运行状态（执行中/完成/失败/取消）。 */
  status: AiRunStatus
  /** 用户本次输入原文。 */
  input: string
  /** host 规划出的任务列表及其执行状态。 */
  plan: AiPlanTask[]
  /** 当前正在执行的任务 ID；为空表示等待 host 继续调度。 */
  activeTaskId?: string
  /** 运行级错误信息（通常来自失败任务或调度异常）。 */
  error?: string
  /** 当前已汇总的输出文本（用于最终回答兜底）。 */
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
