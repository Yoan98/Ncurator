import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { AiRunEvent, BrainStepAction, LLMConfig } from '../../../src/shared/types'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type CaseAssertion = {
  id: string
  pass: boolean
  details?: string
}

export type CaseSuite = 'capability' | 'human-live'
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
}

export type CaseSignalOverrides = {
  scenarioTags?: string[]
  expectedOutcome?: CaseExpectedOutcome
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
}

export type ToolCounts = Record<string, number>
export type ToolResultCodeCounts = Record<string, Record<string, number>>
export type ArtifactOperationCounts = Record<'created' | 'updated', number>

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
  scenarioTags: string[]
  toolSequence: string[]
  toolCounts: ToolCounts
  toolResultCodeCounts: ToolResultCodeCounts
  failedAssertionIds: string[]
  artifactOperationCounts: ArtifactOperationCounts
  finalHumanAction?: BrainStepAction['action']
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
