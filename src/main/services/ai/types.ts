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
  AiRunEventStage,
  JsonObject,
  LLMConfig
} from '../../../shared/types'

export type { AiTaskKind, AiTaskStatus, AiRunStatus, AiPlanTask }

export type AiHostActionName = 'retrieve_context' | 'create_plan' | 'final_answer'

export type AiHostCreatePlanTaskInput = {
  id?: string
  title?: string
  kind?: string
  input?: string
  objective?: string
  preferredCwd?: string
  sourcePath?: string
  outputPath?: string
}

export type AiHostAction =
  | {
      action: 'retrieve_context'
      capabilityKind: AiTaskKind
      objective: string
      preferredCwd?: string
      sourcePath?: string
      outputPath?: string
    }
  | {
      action: 'create_plan'
      tasks: AiHostCreatePlanTaskInput[]
    }
  | {
      action: 'final_answer'
      answer?: string
    }

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
  /** host 决策循环启动时间戳（毫秒）。 */
  hostLoopStartedAt: number
  /** host 决策循环轮次。 */
  hostDecisionRounds: number
  /** 上下文补充动作轮次。 */
  contextEnrichmentRounds: number
  /** host 已获得的上下文证据摘要。 */
  contextEvidence: string[]
  /** host 最近一次动作。 */
  lastHostAction?: AiHostActionName
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
