import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { AiRunEvent, LLMConfig } from '../../../src/shared/types'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type CaseAssertion = {
  id: string
  pass: boolean
  details?: string
}

export type CaseStatus = 'passed' | 'failed'

export type CaseRuntimeMetrics = {
  durationMs: number
  eventCount: number
  toolCallCount: number
  humanStepCount: number
  terminalStepCount: number
  fileArtifactCount: number
}

export type CaseAnalysis = {
  failure_category: string
  suspected_root_cause: string
  optimization_hints: string[]
}

export type CaseReportInput = {
  suite: string
  caseId: string
  runId: string
  taskId: string
  startedAt: number
  finishedAt: number
  status: CaseStatus
  assertions: CaseAssertion[]
  events: AiRunEvent[]
  analysis: CaseAnalysis
  notes: string[]
}

export type LiveLlmConfig = Pick<LLMConfig, 'base_url' | 'model_name' | 'api_key'> & {
  id: string
  name: string
  is_active: true
}
