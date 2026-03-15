import type {
  AiApprovalDecision,
  AiApprovalRequest,
  AiRunContext
} from '../../../src/main/services/ai/types'
import type {
  AiTaskResultCode,
  JsonObject,
  LLMConfig
} from '../../../src/shared/types'
import type { JsonValue } from '../../../src/shared/types'
import type { EventCollector } from '../core/eventCollector'
import type {
  TestDomain,
  TestLayer,
  TestLogEvent,
  TestRunMeta
} from '../core/report-contract'

export type { TestDomain, TestLayer, TestLogEvent, TestRunMeta } from '../core/report-contract'

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

export type TestCaseType = 'basic' | 'scenario'
export type TestRunMode = 'single' | 'repeatable'

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
  assertThat: (condition: boolean, input: { name: string; message: string; data?: JsonValue }) => void
  getFixtureWorkspacePath: (sourcePath: string) => string
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
}

export type TestCaseDefinition<TResult> = {
  caseId: string
  caseType: TestCaseType
  domain: Extract<TestDomain, 'ai' | 'kb-search' | 'other'>
  layer: Extract<TestLayer, 'backend'>
  suite: string
  groups?: readonly string[]
  description: string
  fixtures: readonly string[]
  runMode: TestRunMode
  execute: (runtime: BackendTestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: BackendTestRuntime) => Promise<void>
}
