import type {
  AiApprovalDecision,
  AiApprovalRequest,
  AiRunContext
} from '../../../src/main/services/ai/types'
import type { HumanTaskRunner } from '../../../src/main/services/ai/types'
import type { DraftReviewService } from '../../../src/main/services/ai/human/tools/docx/review/DraftReviewService'
import type { ChatStore } from '../../../src/main/services/storage/domains/ChatStore'
import type { DocumentsStore } from '../../../src/main/services/storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../../src/main/services/storage/domains/DraftReviewStore'
import type { LlmConfigStore } from '../../../src/main/services/storage/domains/LlmConfigStore'
import type { StorageService } from '../../../src/main/services/storage/StorageService'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type {
  ChatMessage,
  ChatSessionMemory,
  DraftReviewDocument,
  DraftReviewStatus,
  JsonObject,
  JsonValue,
  LLMConfig,
  SelectedReference
} from '../../../src/shared/types'
import type { EventCollector } from '../core/eventCollector'
import type {
  TestDomain,
  TestType,
  TestLogEvent,
  TestRunMeta
} from '../core/report-contract'

export type { TestDomain, TestType, TestLogEvent, TestRunMeta } from '../core/report-contract'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type BackendHarnessMode = 'tool-real' | 'mock-llm' | 'live'

export type ScriptedStructuredOutputCall = {
  caller: string
  schemaName: string
  system: string
  user: string
  callIndex: number
}

export type ScriptedStructuredOutputStep =
  | {
      output: JsonObject
    }
  | {
      error: string
    }
  | ((input: ScriptedStructuredOutputCall) => JsonObject | Promise<JsonObject>)

export type StructuredOutputScript = Partial<
  Record<string, readonly ScriptedStructuredOutputStep[]>
>

export type LiveLlmConfig = Pick<LLMConfig, 'base_url' | 'model_name' | 'api_key'> & {
  id: string
  name: string
  is_active: true
}

export type TestRunMode = 'single' | 'repeatable'

export type FixtureBinding = {
  sourcePath: string
  workspacePath: string
}

export type SeedKbChunkInput = {
  id: string
  text: string
  page?: number
}

export type SeedKbDocumentInput = {
  id: string
  name: string
  sourceType?: 'file' | 'web'
  filePath?: string
  createdAt?: number
  chunks: readonly SeedKbChunkInput[]
}

export type SeedWorkspaceFileRecord = {
  relativePath: string
  absolutePath: string
  summary?: string
  metadata?: JsonValue
}

export type BackendSeedManifest = {
  schemaVersion: 1
  workspaceFiles: SeedWorkspaceFileRecord[]
  kbDocuments: SeedKbDocumentInput[]
}

export type SeedChatHistoryInput = {
  sessionId: string
  title?: string
  createdAt?: number
  messages: readonly Array<{
    id: string
    role: ChatMessage['role']
    content: string
    timestamp: number
    sources?: string
    error?: boolean
  }>
  memory?: ChatSessionMemory
}

export type SeedDraftReviewInput = {
  reviewId?: string
  sessionId?: string
  runId?: string
  title?: string
  status?: DraftReviewStatus
  createdAt?: number
  updatedAt?: number
  documents: readonly Array<{
    sourcePath: string
    confirmBasePath?: string
    sourceName?: string
    sourceDocumentId?: string
    format?: DraftReviewDocument['format']
    latestDraftSnapshotId?: string
  }>
}

export type CreateAiRunContextInput = {
  bindWorkspace?: boolean
  sessionId?: string
  userInput?: string
  selectedDocumentIds?: string[]
  selectedReferences?: SelectedReference[]
  modelConfigId?: string
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  checkCancelledOverride?: () => void
  humanRuntimeOverrides?: {
    hardActionLimit?: number
  }
  structuredOutputScript?: StructuredOutputScript
}

export type BackendTestRuntime = {
  mode: BackendHarnessMode
  runId: string
  taskId: string
  workspaceRoot: string
  fixtureBindings: FixtureBinding[]
  eventCollector: EventCollector
  storageService: StorageService
  documentsStore: DocumentsStore
  chatStore: ChatStore
  draftReviewStore: DraftReviewStore
  llmStore: LlmConfigStore
  embeddingService: EmbeddingService
  draftReviewService: DraftReviewService
  recordEvent: (input: Omit<TestLogEvent, 'ts'>) => void
  assertThat: (condition: boolean, input: { name: string; message: string; data?: JsonValue }) => void
  getFixtureWorkspacePath: (sourcePath: string) => string
  recordSeedWorkspaceFile: (input: SeedWorkspaceFileRecord) => void
  getSeedManifest: () => BackendSeedManifest
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
  createHumanTaskRunner: (input?: CreateAiRunContextInput) => HumanTaskRunner
  ensureEmbeddingReady: () => Promise<void>
  seedKb: (input: readonly SeedKbDocumentInput[]) => Promise<void>
  seedChatHistory: (input: SeedChatHistoryInput) => Promise<void>
  seedDraftReview: (input: SeedDraftReviewInput) => Promise<{ reviewId: string }>
  seedLlmConfig: (config: LiveLlmConfig) => Promise<void>
}

export type TestCaseDefinition<TResult> = {
  caseId: string
  harnessMode: BackendHarnessMode
  testType?: Extract<TestType, 'backend'>
  domain: Extract<TestDomain, 'ai' | 'workbench' | 'settings' | 'kb-search' | 'temp'>
  suite: string
  groups?: readonly string[]
  description: string
  fixtures: readonly string[]
  runMode: TestRunMode
  runtimeModelName?: string | null
  execute: (runtime: BackendTestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: BackendTestRuntime) => Promise<void>
}
