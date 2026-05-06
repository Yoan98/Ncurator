import type {
  AiApprovalDecision,
  AiApprovalRequest,
  AiRunContext
} from '../../../src/main/services/ai/types'
import type { HumanTaskRunner } from '../../../src/main/services/ai/types'
import type { FileReviewService } from '../../../src/main/services/ai/human/tools/docx/review/FileReviewService'
import type { ChatStore } from '../../../src/main/services/storage/domains/ChatStore'
import type { DocumentsStore } from '../../../src/main/services/storage/domains/DocumentsStore'
import type { FileReviewStore } from '../../../src/main/services/storage/domains/FileReviewStore'
import type { LlmConfigStore } from '../../../src/main/services/storage/domains/LlmConfigStore'
import type { StorageService } from '../../../src/main/services/storage/StorageService'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { WorkspaceSourceService } from '../../../src/main/services/workspace/WorkspaceSourceService'
import type { WorkspaceKnowledgePrepareService } from '../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import type {
  ChatMessage,
  ChatSessionMemory,
  FileReview,
  FileReviewStatus,
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
} from '../core/run-log-contract'

export type { TestDomain, TestType, TestLogEvent, TestRunMeta } from '../core/run-log-contract'

export type ApprovalPolicy = 'auto-approve' | 'deny-medium-high' | 'deny-all'

export type ApprovalResolver = (request: AiApprovalRequest) => AiApprovalDecision

export type BackendHarnessMode = 'tool-real' | 'mock-llm' | 'live'

export type ScriptedLlmCall = {
  caller: string
  schemaName: string
  system: string
  user: string
  callIndex: number
  mode: 'structured' | 'text'
}

type ScriptedLlmStreamShape = {
  chunks?: string[]
}

export type ScriptedLlmStep =
  | {
      output: JsonObject
    } & ScriptedLlmStreamShape
  | {
      text: string
    } & ScriptedLlmStreamShape
  | {
      error: string
    }
  | ((input: ScriptedLlmCall) => JsonObject | string | Promise<JsonObject | string>)

export type LlmScript = Partial<Record<string, readonly ScriptedLlmStep[]>>
export type StructuredOutputScript = LlmScript

export type LiveLlmConfig = Pick<
  LLMConfig,
  'providerKind' | 'base_url' | 'model_name' | 'api_key'
> & {
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
  workspaceId?: string
  sourceType?: 'file' | 'web'
  filePath?: string
  createdAt?: number
  chunks: readonly SeedKbChunkInput[]
}

export type WorkspaceKbSeedMode = 'all-supported' | 'include-only' | 'exclude-some'

export type WorkspaceKbSeedInput = {
  mode: WorkspaceKbSeedMode
  relativePaths?: readonly string[]
}

export type WorkspaceKbSeedResult = {
  relativePath: string
  absolutePath: string
  name: string
  fileExt?: string
  supported: boolean
  status: 'indexed' | 'failed' | 'skipped'
  documentId?: string
  chunkCount?: number
  kbAvailability: SelectedReference['kbAvailability']
  kbDocumentIds: string[]
  cache: {
    split: boolean
    vector: boolean
  }
  error?: string
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

export type SeedFileReviewInput = {
  reviewId?: string
  sessionId?: string
  runId?: string
  title?: string
  status?: FileReviewStatus
  createdAt?: number
  updatedAt?: number
  file: {
    sourcePath: string
    confirmBasePath?: string
    sourceName?: string
    sourceDocumentId?: string
    outputOperation?: FileReview['output_operation']
    format?: FileReview['format']
    latestDraftSnapshotId?: string
  }
}

export type CreateAiRunContextInput = {
  bindWorkspace?: boolean
  sessionId?: string
  userInput?: string
  selectedReferences?: SelectedReference[]
  runtimeSettingsOverride?: Partial<AiRuntimeSettings>
  modelConfigId?: string
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  checkCancelledOverride?: () => void
  humanRuntimeOverrides?: {
    hardActionLimit?: number
  }
  llmScript?: LlmScript
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
  workspaceSourceService: WorkspaceSourceService
  workspaceKnowledgePrepareService: WorkspaceKnowledgePrepareService
  documentsStore: DocumentsStore
  chatStore: ChatStore
  fileReviewStore: FileReviewStore
  llmStore: LlmConfigStore
  embeddingService: EmbeddingService
  fileReviewService: FileReviewService
  recordEvent: (input: Omit<TestLogEvent, 'ts'>) => void
  assertThat: (condition: boolean, input: { name: string; message: string; data?: JsonValue }) => void
  getFixtureWorkspacePath: (sourcePath: string) => string
  recordSeedWorkspaceFile: (input: SeedWorkspaceFileRecord) => void
  getSeedManifest: () => BackendSeedManifest
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
  createHumanTaskRunner: (input?: CreateAiRunContextInput) => HumanTaskRunner
  ensureEmbeddingReady: () => Promise<void>
  seedKb: (input: readonly SeedKbDocumentInput[]) => Promise<void>
  seedWorkspaceKb: (input: WorkspaceKbSeedInput) => Promise<WorkspaceKbSeedResult[]>
  seedChatHistory: (input: SeedChatHistoryInput) => Promise<void>
  seedFileReview: (input: SeedFileReviewInput) => Promise<{ reviewId: string }>
  seedLlmConfig: (config: LiveLlmConfig) => Promise<void>
}

export type TestCaseDefinition<TResult> = {
  caseId: string
  harnessMode: BackendHarnessMode
  testType?: Extract<TestType, 'backend'>
  domain: Extract<TestDomain, 'ai' | 'settings' | 'kb-search' | 'temp'>
  suite: string
  groups?: readonly string[]
  description: string
  fixtures: readonly string[]
  runMode: TestRunMode
  runtimeModelName?: string | null
  execute: (runtime: BackendTestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: BackendTestRuntime) => Promise<void>
}
