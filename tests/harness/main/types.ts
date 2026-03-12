import type { AiApprovalDecision, AiApprovalRequest, AiRunContext } from '../../../src/main/services/ai/types'
import type {
  AiRunEvent,
  AiRunEventStage,
  AiTaskResultCode,
  HumanStepAction,
  JsonObject,
  JsonValue,
  LLMConfig,
  RuntimeSkillId
} from '../../../src/shared/types'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type TestDocumentsStoreOverrides = Partial<
  Pick<AiRunContext['documentsStore'], 'hybridSearch' | 'vectorSearch' | 'ftsSearch' | 'listDocuments'>
>

export type TestToolExecutionOverride = {
  toolName: string
  remainingUses?: number
  result: {
    ok: boolean
    code: AiTaskResultCode
    summary: string
    data?: JsonValue
  }
}

export type CaseAssertion = {
  id: string
  pass: boolean
  details?: string
}

export type CaseSuite =
  | 'main-ai-capability'
  | 'main-ai-runtime'
  | 'main-ai-human'
  | 'main-workspace-service'
  | 'main-workspace-migration'
export type CaseStatus = 'passed' | 'failed'
export type CaseErrorCode =
  | 'none'
  | 'fixture_missing'
  | 'live_config_missing'
  | 'assertion_failed'
  | 'runtime_exception'
export type CaseExecutionStatus = 'completed' | 'blocked' | 'failed' | 'not_run' | 'unknown'
export type CaseExpectedOutcome = 'success' | 'blocked' | 'explicit_gap' | 'failure'

export type CaseExecutionOutcome = {
  status: CaseExecutionStatus
  resultCode: string
  summary?: string
  resultData?: JsonObject
}

export type CaseSignalOverrides = {
  scenarioTags?: string[]
  expectedOutcome?: CaseExpectedOutcome
  taskGoal?: string
  maxSteps?: number
  approvalPolicy?: ApprovalPolicy
  modelName?: string
}

export type CaseRuntimeMetrics = {
  durationMs: number
  eventCount: number
  toolCallCount: number
  humanStepCount: number
  terminalStepCount: number
  fileArtifactCount: number
  approvalRequiredCount: number
  approvalApprovedCount: number
  approvalDeniedCount: number
  workspaceRequiredCount: number
  warningCount: number
  toolErrorCount?: number
  recoveryAfterErrorCount?: number
  repeatedToolCallCount?: number
  stepBudgetUsage?: number
  qualityGrade?: CaseQualityGrade
}

export type ToolCounts = Record<string, number>
export type ToolResultCodeCounts = Record<string, Record<string, number>>
export type ArtifactOperationCounts = Record<'created' | 'updated', number>
export type StepActionCounts = Record<HumanStepAction, number>
export type CaseQualityGrade =
  | 'hard_pass'
  | 'soft_pass'
  | 'expected_block'
  | 'unexpected_block'
  | 'harness_fail'
  | 'unknown'

export type CaseAssertionsReport = {
  suite: CaseSuite
  caseId: string
  runId: string
  taskId: string
  caseStatus: CaseStatus
  assertionTotal: number
  assertionPassed: number
  assertionFailed: number
  failedAssertionIds: string[]
  assertions: CaseAssertion[]
}

export type CaseMetricsReport = CaseRuntimeMetrics & {
  suite: CaseSuite
  caseId: string
  runId: string
  taskId: string
  startedAt: number
  finishedAt: number
  caseStatus: CaseStatus
  caseErrorCode: CaseErrorCode
  executionStatus: CaseExecutionStatus
  executionResultCode: string
}

export type CaseSignalsReport = {
  suite: CaseSuite
  caseId: string
  runId: string
  taskId: string
  expectedOutcome?: CaseExpectedOutcome
  taskGoal?: string
  maxSteps?: number
  approvalPolicy?: ApprovalPolicy
  modelName?: string
  scenarioTags: string[]
  toolSequence: string[]
  toolCounts: ToolCounts
  toolResultCodeCounts: ToolResultCodeCounts
  stepActionSequence: HumanStepAction[]
  stepActionCounts: StepActionCounts
  skillActivationSequence: RuntimeSkillId[]
  failedAssertionIds: string[]
  artifactOperationCounts: ArtifactOperationCounts
  resultDataKeys: string[]
  firstFailureStage?: AiRunEventStage
  finalHumanAction?: HumanStepAction
  executionSummary?: string
}

export type CaseReportInput = {
  suite: CaseSuite
  caseId: string
  runId: string
  taskId: string
  startedAt: number
  finishedAt: number
  caseStatus: CaseStatus
  caseErrorCode: CaseErrorCode
  execution: CaseExecutionOutcome
  signalOverrides?: CaseSignalOverrides
  assertions: CaseAssertion[]
  events: AiRunEvent[]
  notes: string[]
}

export type CaseReportArtifacts = {
  reportDir: string
  summary: string
  assertions: CaseAssertionsReport
  metrics: CaseMetricsReport
  signals: CaseSignalsReport
  events: AiRunEvent[]
}

export type LiveLlmConfig = Pick<LLMConfig, 'base_url' | 'model_name' | 'api_key'> & {
  id: string
  name: string
  is_active: true
}
