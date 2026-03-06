import {
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_REQUIREMENTS
} from './constants'

export type DocumentSourceType = 'file' | 'web'
export type DocumentImportStatus = 1 | 2 | 3
export type SearchSourceFilter = 'all' | DocumentSourceType
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type IpcJsonPrimitive = JsonPrimitive
export type IpcJsonObject = object
export type IpcJsonArray = IpcJsonValue[]
export type IpcJsonValue = IpcJsonPrimitive | IpcJsonObject | IpcJsonArray

export interface WebIngestPayload {
  url: string
  includeSelectors?: string[]
  excludeSelectors?: string[]
}

export interface DocumentRecord {
  id: string
  name: string
  source_type: DocumentSourceType
  file_path?: string
  created_at: number
  import_status: DocumentImportStatus
}

export interface SearchResult {
  id: string
  text: string
  document_name: string
  document_id?: string
  source_type?: string
  // IPC 传输时为 JSON string，后端存储时为对象
  metadata?:
    | string
    | {
        page: number
      }
  _distance?: number
  created_at?: number
  _score?: number
  _relevance_score?: number
  document?: DocumentRecord
}

export interface SearchResponse {
  results: SearchResult[]
  tokens: string[]
}

export interface ChunkListItem {
  id: string
  text: string
  document_name: string
  document_id?: string
  source_type?: string
  // IPC 传输时为 JSON string，后端存储时为对象
  metadata?:
    | string
    | {
        page: number
      }
  created_at?: number
  vector?: number[]
}

export interface ChunkListResponse {
  items: ChunkListItem[]
  total: number
}

// Deprecated: kept for backward compatibility if needed, but should be removed eventually
export interface DocumentListItem extends ChunkListItem {}

export interface DocumentListResponse {
  items: DocumentRecord[]
  total: number
}

// Chat & LLM Types

export interface LLMConfig {
  id: string
  name: string
  base_url: string
  model_name: string
  api_key: string
  is_active: boolean
}

export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  // JSON string of SearchResult[]
  sources?: string
  error?: boolean
}

export interface ChatSession {
  id: string
  title: string
  created_at: number
}

export type AiTaskKind = 'local_kb_retrieval' | 'terminal_exec' | 'docx'
export type AiTaskStatus = 'pending' | 'running' | 'completed' | 'failed'
export type AiRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type RuntimeSkillRequirement = (typeof RUNTIME_SKILL_REQUIREMENTS)[number]
export type AiRunEventStage =
  | 'main_intent'
  | 'main_context_enrich'
  | 'main_plan'
  | 'main_plan_exec'
  | 'main_finalize'
  | 'human_brain'
  | 'human_skill_loader'
  | 'human_tool_exec'
export type AiTaskResultCode =
  | 'ok'
  | 'failed'
  | 'workspace_required'
  | 'approval_denied'
  | 'bounded_loop_error'
  | 'invalid_input'
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]

export type SkillCard = {
  id: RuntimeSkillId
  name: string
  summary: string
  whenToUse: string
  unlocks: string[]
  requires?: RuntimeSkillRequirement[]
}

export type HumanLoadSkillDecision = {
  action: 'load_skill'
  skillId: RuntimeSkillId
  rationale: string
  publicNarrative: string
}

export type HumanInvokeToolDecision = {
  action: 'invoke_tool'
  toolName: string
  args: JsonObject
  rationale: string
  publicNarrative: string
}

export type HumanCompleteTaskDecision = {
  action: 'complete_task'
  summary: string
  rationale: string
  publicNarrative: string
  resultData?: JsonObject
}

export type HumanBlockTaskDecision = {
  action: 'block_task'
  reason: string
  rationale: string
  publicNarrative: string
  details?: JsonValue
}

export type HumanStepDecision =
  | HumanLoadSkillDecision
  | HumanInvokeToolDecision
  | HumanCompleteTaskDecision
  | HumanBlockTaskDecision

export type HumanStepRecord = {
  step: number
  action: HumanStepAction
  publicNarrative: string
  activeSkillIds: RuntimeSkillId[]
  activeToolNames: string[]
  resultStatus?: HumanStepResultStatus
  skillId?: RuntimeSkillId
  toolName?: string
  summary?: string
}

export type DiagnosticTrace = {
  rationale: string
  selectedSkillId?: RuntimeSkillId
  selectedToolName?: string
  args?: JsonObject
  observationSummary?: string
  switchReason?: string
}

export type CapabilityResult = {
  toolName: string
  capability?: AiTaskKind
  success: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonObject
}

export type HumanTaskInput = {
  // main 分配的任务 ID（run 内唯一）。
  taskId: string
  // 任务目标（human 实际执行依据）。
  objective: string
}

export type HumanTaskOutput = {
  taskId: string
  status: 'completed' | 'blocked'
  summary: string
  resultCode: AiTaskResultCode
  resultData?: JsonObject
}

export type AiFileArtifactCapability = 'terminal_exec' | 'docx'
export type AiFileArtifactOperation = 'created' | 'updated'

export type AiPlanTask = {
  id: string
  title: string
  objective: string
  status: AiTaskStatus
  attempts: number
  error?: string
  resultCode?: AiTaskResultCode
  resultMessage?: string
  resultData?: JsonObject
}

export type AiRunStartRequest = {
  sessionId: string
  input: string
  selectedDocumentIds?: string[]
  workspace?: {
    workspaceId: string
    rootPath: string
    policyProfile?: string
  }
}

export type AiRunStartResponse = {
  success: boolean
  runId?: string
  error?: string
}

export type AiRunCancelResponse = {
  success: boolean
  error?: string
}

export type AiRunApprovalDecisionRequest = {
  runId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export type AiRunApprovalDecisionResponse = {
  success: boolean
  error?: string
}

type AiRunEventPayload =
  | {
      type: 'run_started'
      runId: string
      sessionId: string
      createdAt: number
      input: string
    }
  | {
      type: 'plan_created'
      runId: string
      plan: AiPlanTask[]
    }
  | {
      type: 'task_started'
      runId: string
      taskId: string
    }
  | {
      type: 'task_completed'
      runId: string
      taskId: string
    }
  | {
      type: 'task_result'
      runId: string
      taskId: string
      code: AiTaskResultCode
      message?: string
      data?: JsonObject
    }
  | {
      type: 'task_failed'
      runId: string
      taskId: string
      error: string
    }
  | {
      type: 'tool_call_started'
      runId: string
      taskId?: string
      toolCallId: string
      toolName: string
      input: IpcJsonObject
      createdAt: number
    }
  | {
      type: 'tool_call_result'
      runId: string
      taskId?: string
      toolCallId: string
      toolName: string
      outputPreview: IpcJsonValue
      completedAt: number
      error?: string
    }
  | {
      type: 'terminal_step_started'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      cwd: string
      createdAt: number
    }
  | {
      type: 'terminal_step_result'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      outputPreview: string
      exitCode: number | null
      timedOut: boolean
      truncated: boolean
      completedAt: number
    }
  | {
      type: 'terminal_step_error'
      runId: string
      taskId: string
      stepId: string
      stepIndex: number
      command: string
      error: string
      outputPreview?: string
      completedAt: number
    }
  | {
      type: 'activity'
      runId: string
      taskId?: string
      activityId: string
      actionType: string
      status: 'started' | 'completed' | 'failed'
      summary: string
      createdAt: number
    }
  | {
      type: 'human_step'
      runId: string
      taskId: string
      stepIndex: number
      action: HumanStepAction
      skillId?: RuntimeSkillId
      toolName?: string
      publicNarrative: string
      activeSkillIds: RuntimeSkillId[]
      activeToolNames: string[]
      resultStatus?: HumanStepResultStatus
      summary: string
      createdAt: number
    }
  | {
      type: 'human_diagnostic'
      runId: string
      taskId: string
      stepIndex: number
      action: HumanStepAction
      trace: DiagnosticTrace
      createdAt: number
    }
  | {
      type: 'file_artifact'
      runId: string
      taskId: string
      artifactId: string
      capability: AiFileArtifactCapability
      path: string
      fileName: string
      operation: AiFileArtifactOperation
      summary: string
      stepId?: string
      createdAt: number
    }
  | {
      type: 'workspace_required'
      runId: string
      taskId: string
      reason: string
      requiredFields: Array<'workspaceId' | 'rootPath'>
      createdAt: number
    }
  | {
      type: 'approval_required'
      runId: string
      taskId: string
      approvalId: string
      command: string
      riskLevel: 'medium' | 'high'
      reason: string
      createdAt: number
    }
  | {
      type: 'approval_decision'
      runId: string
      taskId: string
      approvalId: string
      approved: boolean
      reason?: string
      decidedAt: number
    }
  | {
      type: 'answer_token'
      runId: string
      token: string
    }
  | {
      type: 'answer_completed'
      runId: string
      text: string
    }
  | {
      type: 'run_completed'
      runId: string
    }
  | {
      type: 'run_failed'
      runId: string
      error: string
    }
  | {
      type: 'run_cancelled'
      runId: string
    }

export type AiRunEvent = AiRunEventPayload & {
  internal?: boolean
  stage?: AiRunEventStage
}

export type ChatSessionMemory = {
  summary: string
  openTasks: string[]
  userPrefs: string[]
  pinnedFacts: string[]
  linkedDocumentIds: string[]
}

export type ChatSessionMemoryRow = {
  session_id: string
  memory_json: string
  updated_at: number
}
