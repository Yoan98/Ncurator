import type {
  AiApprovalDecision,
  AiApprovalRequest,
  AiRunContext
} from '../../../src/main/services/ai/types'
import type {
  AiTaskResultCode,
  JsonObject,
  JsonValue,
  LLMConfig
} from '../../../src/shared/types'
import type { EventCollector } from '../core/eventCollector'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type TestDocumentsStoreOverrides = Partial<
  Pick<
    AiRunContext['documentsStore'],
    'hybridSearch' | 'vectorSearch' | 'ftsSearch' | 'listDocuments' | 'getDocumentById'
  >
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

export type LiveLlmConfig = Pick<LLMConfig, 'base_url' | 'model_name' | 'api_key'> & {
  id: string
  name: string
  is_active: true
}

export type TestDomain = 'ai' | 'kb-search' | 'other'
export type TestLayer = 'backend' | 'e2e'
export type TestCaseType = 'basic' | 'scenario'
export type TestRunMode = 'single' | 'repeatable'
export type TestRunStatus = 'passed' | 'failed'
export type TestLogStatus = 'info' | 'ok' | 'failed' | 'skipped'

export type TestLogEvent = {
  ts: string
  kind: string
  status: TestLogStatus
  message: string
  detail?: JsonValue
}

export type TestRunMeta = {
  runId: string
  caseId: string
  scope: string
  domain: TestDomain
  layer: TestLayer
  suite: string
  capability: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
  status: TestRunStatus
  modelName: string | null
  fixtures: string[]
}

export type FixtureBinding = {
  sourcePath: string
  workspacePath: string
}

export type CreateAiRunContextInput = {
  bindWorkspace?: boolean
  selectedDocumentIds?: string[]
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  liveModelConfig?: LiveLlmConfig
  chatJsonOverride?: <T extends JsonObject>(input: {
    system: string
    user: string
    temperature?: number
  }) => Promise<T>
  historyOverride?: {
    recentTurnsText: string
    sessionSummaryText: string
  }
  documentsStoreOverrides?: TestDocumentsStoreOverrides
  toolExecutionOverrides?: TestToolExecutionOverride[]
}

export type BackendTestRuntime = {
  runId: string
  taskId: string
  workspaceRoot: string
  fixtureBindings: FixtureBinding[]
  eventCollector: EventCollector
  recordEvent: (input: Omit<TestLogEvent, 'ts'>) => void
  assertThat: (condition: boolean, message: string, detail?: JsonValue) => void
  getFixtureWorkspacePath: (sourcePath: string) => string
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
}

export type TestCaseDefinition<TResult> = {
  caseId: string
  caseType: TestCaseType
  domain: Extract<TestDomain, 'ai' | 'kb-search' | 'other'>
  layer: Extract<TestLayer, 'backend'>
  suite: string
  capability?: string
  description: string
  fixtures: readonly string[]
  runMode: TestRunMode
  execute: (runtime: BackendTestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: BackendTestRuntime) => Promise<void>
}
