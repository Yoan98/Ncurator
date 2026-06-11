import type {
  AiApprovalBatchRequest,
  AiApprovalBatchResult,
  AiRunContext
} from '../../../src/main/services/ai/types'
import type { HumanTaskRunner } from '../../../src/main/services/ai/types'
import type { DocxApplyService } from '../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import type { ChatStore } from '../../../src/main/services/storage/domains/ChatStore'
import type { DocumentsStore } from '../../../src/main/services/storage/domains/DocumentsStore'
import type { DocxApplyStore } from '../../../src/main/services/storage/domains/DocxApplyStore'
import type { LlmConfigStore } from '../../../src/main/services/storage/domains/LlmConfigStore'
import type { StorageService } from '../../../src/main/services/storage/StorageService'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { WorkspaceSourceService } from '../../../src/main/services/workspace/WorkspaceSourceService'
import type { WorkspaceKnowledgePrepareService } from '../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import type { WebCrawlerService } from '../../../src/main/services/webCrawler/types'
import type {
  ChatMessage,
  ChatConversationMemory,
  AiLlmUsage,
  JsonObject,
  JsonValue,
  LLMConfig,
  LlmRuntimeConfig,
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

export type ApprovalResolver = (request: AiApprovalBatchRequest) => AiApprovalBatchResult

export type BackendHarnessMode = 'tool-real' | 'mock-llm' | 'live'

export type ScriptedLlmCall = {
  caller: string
  schemaName: string
  system: string
  user: string
  callIndex: number
  mode: 'structured' | 'text'
  signal?: AbortSignal
}

type ScriptedLlmStreamShape = {
  chunks?: string[]
}

export type ScriptedLlmStep =
  | {
      output: JsonObject
      usage?: AiLlmUsage
    } & ScriptedLlmStreamShape
  | {
      text: string
      usage?: AiLlmUsage
    } & ScriptedLlmStreamShape
  | {
      error: string
    }
  | {
      waitForAbort: true
      onAbortError?: string
    }
  | {
      waitMs: number
      thenError: string
    }
  | ((input: ScriptedLlmCall) => JsonObject | string | Promise<JsonObject | string>)

export type LlmScript = Partial<Record<string, readonly ScriptedLlmStep[]>>
export type StructuredOutputScript = LlmScript

export type LiveLlmConfig = Pick<
  LlmRuntimeConfig,
  'providerKind' | 'base_url' | 'model_name' | 'api_key'
> & {
  id: string
  is_active: true
  default_model: string
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
    artifacts?: ChatMessage['artifacts']
    error?: boolean
  }>
  memory?: ChatConversationMemory
}

export type CreateAiRunContextInput = {
  bindWorkspace?: boolean
  sessionId?: string
  userInput?: string
  selectedReferences?: SelectedReference[]
  allowedToolNames?: string[]
  runtimeSettingsOverride?: Partial<AiRuntimeSettings>
  modelName?: string
  approvalPolicy?: ApprovalPolicy | ApprovalResolver
  checkCancelledOverride?: () => void
  humanRuntimeOverrides?: {
    hardActionLimit?: number
    modelContextWindowTokens?: number
  }
  llmScript?: LlmScript
  structuredOutputScript?: StructuredOutputScript
  webCrawlerService?: WebCrawlerService
}

export type BackendTestRuntime = {
  mode: BackendHarnessMode
  runId: string
  taskId: string
  runtimeModelName?: string | null
  workspaceRoot: string
  fixtureBindings: FixtureBinding[]
  eventCollector: EventCollector
  storageService: StorageService
  workspaceSourceService: WorkspaceSourceService
  workspaceKnowledgePrepareService: WorkspaceKnowledgePrepareService
  documentsStore: DocumentsStore
  chatStore: ChatStore
  docxApplyStore: DocxApplyStore
  llmStore: LlmConfigStore
  embeddingService: EmbeddingService
  docxApplyService: DocxApplyService
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
