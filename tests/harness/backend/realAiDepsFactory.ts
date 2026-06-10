import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createHumanGraphRunner } from '../../../src/main/services/ai/human/graph/humanGraph'
import { AiFileChangeService } from '../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { DocxApplyService } from '../../../src/main/services/ai/human/tools/docx/review/DocxApplyService'
import { createAiRunContext } from '../../../src/main/services/ai/runtime'
import { runAiRuntimePreflight } from '../../../src/main/services/ai/runtimePreflight'
import type { AiApprovalBatchRequest, AiApprovalBatchResult } from '../../../src/main/services/ai/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { ModelService } from '../../../src/main/services/model/ModelService'
import { StorageService } from '../../../src/main/services/storage/StorageService'
import { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import { ensureEmbeddingReady } from '../../../src/main/services/vector/ensureEmbeddingReady'
import { WorkspaceKnowledgePrepareService } from '../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import type { WebCrawlerService } from '../../../src/main/services/webCrawler/types'
import { WorkspaceSourceService } from '../../../src/main/services/workspace/WorkspaceSourceService'
import type { AiRuntimeSettings } from '../../../src/shared/types'
import type { BackendHarnessMode, CreateAiRunContextInput, LiveLlmConfig } from './test-types'
import type { EventCollector } from '../core/eventCollector'
import { createScriptedStructuredOutputDriver } from './scriptedStructuredOutputDriver'

const SCRIPTED_LLM_CONFIG: LiveLlmConfig = {
  id: 'mock-llm-scripted',
  providerKind: 'openai-compatible',
  base_url: 'https://scripted.local/v1',
  model_name: 'scripted-llm',
  api_key: 'scripted',
  is_active: true,
  default_model: 'scripted-llm'
}

const DEFAULT_RUNTIME_SETTINGS: AiRuntimeSettings = {
  llmStreamingMode: 'force_stream'
}

const resolveRuntimeModelName = (input: {
  mode: BackendHarnessMode
  explicitModelName?: string
  defaultModelName?: string | null
}): string | undefined => {
  const explicitModelName = String(input.explicitModelName || '').trim()
  if (explicitModelName) return explicitModelName

  const defaultModelName = String(input.defaultModelName || '').trim()
  if (defaultModelName) return defaultModelName

  return input.mode === 'mock-llm' ? SCRIPTED_LLM_CONFIG.model_name : undefined
}

const buildApprovalResolver = (
  policy: CreateAiRunContextInput['approvalPolicy']
): ((request: AiApprovalBatchRequest) => AiApprovalBatchResult) => {
  if (typeof policy === 'function') return policy
  if (policy === 'deny-all') {
    return (request) => ({
      accepted: true,
      decisions: request.items.map((item) => ({
        itemId: item.itemId,
        action: 'reject'
      }))
    })
  }
  if (policy === 'deny-medium-high') {
    return (request) => ({
      accepted: true,
      decisions: request.items.map((item) => ({
        itemId: item.itemId,
        action: 'reject'
      }))
    })
  }
  return (request) => ({
    accepted: true,
    decisions: request.items.map((item) => ({
      itemId: item.itemId,
      action: 'approve'
    }))
  })
}

export type RealAiDepsFactory = {
  storageService: StorageService
  embeddingService: EmbeddingService
  workspaceSourceService: WorkspaceSourceService
  workspaceKnowledgePrepareService: WorkspaceKnowledgePrepareService
  docxApplyService: DocxApplyService
  ensureEmbeddingReady: () => Promise<void>
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
  createHumanTaskRunner: (input?: CreateAiRunContextInput) => ReturnType<typeof createHumanGraphRunner>
  seedLlmConfig: (config: LiveLlmConfig) => Promise<void>
  close: () => Promise<void>
}

export const createRealAiDepsFactory = async (input: {
  mode: BackendHarnessMode
  runId: string
  runtimeModelName?: string | null
  workspaceRoot: string
  eventCollector: EventCollector
}): Promise<RealAiDepsFactory> => {
  const storageService = new StorageService({
    dbPath: path.join(input.workspaceRoot, '.ncurator-test', 'lancedb')
  })
  await storageService.initialize()

  const embeddingService = new EmbeddingService()
  const modelService = ModelService.getInstance()
  const workspaceSourceService = new WorkspaceSourceService()
  const workspaceKnowledgePrepareService = new WorkspaceKnowledgePrepareService({
    embeddingService,
    documentsStore: storageService.documents
  })

  const aiFileChangeService = new AiFileChangeService(storageService.aiFileChange)
  const docxApplyService = new DocxApplyService(storageService.docxApply, aiFileChangeService)

  const seedLlmConfig = async (config: LiveLlmConfig): Promise<void> => {
    const { model_name: _modelName, ...persistedConfig } = config
    await storageService.llm.save(persistedConfig)
    await storageService.llm.setActive(config.id)
  }

  if (input.mode === 'mock-llm') {
    await seedLlmConfig(SCRIPTED_LLM_CONFIG)
  }

  const ensureReady = async (): Promise<void> => {
    await ensureEmbeddingReady({
      embeddingService,
      modelService
    })
  }

  const createContext = (contextInput: CreateAiRunContextInput = {}): AiRunContext => {
    const llmScript = contextInput.llmScript || contextInput.structuredOutputScript
    if (input.mode !== 'mock-llm' && llmScript) {
      throw new Error(
        `llmScript is only allowed in mock-llm mode; mode=${input.mode}`
      )
    }

    const bindWorkspace = contextInput.bindWorkspace !== false
    const approvalResolver = buildApprovalResolver(contextInput.approvalPolicy)
    const runtimeSettings: AiRuntimeSettings = {
      ...DEFAULT_RUNTIME_SETTINGS,
      ...contextInput.runtimeSettingsOverride
    }

    const ctx = createAiRunContext(
      {
        runId: input.runId,
        sessionId: contextInput.sessionId || 'test-session',
        input: contextInput.userInput || '请处理当前测试任务。',
        selectedReferences: contextInput.selectedReferences,
        modelName: resolveRuntimeModelName({
          mode: input.mode,
          explicitModelName: contextInput.modelName,
          defaultModelName: input.runtimeModelName
        }),
        workspace: bindWorkspace
          ? {
              workspaceId: 'test-workspace',
              workspaceName: 'test-workspace',
              rootPath: input.workspaceRoot
            }
          : undefined
      },
      {
        runtimeSettings,
        llmStore: storageService.llm,
        chatStore: storageService.chat,
        documentsStore: storageService.documents,
        embeddingService,
        ensureEmbeddingReady: ensureReady,
        docxApplyService,
        saveFileChangeRecord: async (record) => {
          await aiFileChangeService.saveRecord(record)
        },
        listFileChangeRecords: async (request) =>
          (await aiFileChangeService.listRecords(request)).items,
        isCancelled: contextInput.checkCancelledOverride || (() => false),
        sendEvent: (event) => input.eventCollector.add(event),
        recordLlmIo: (record) => input.eventCollector.addLlmIo(record),
        requestApprovalBatch: async (request) => {
          input.eventCollector.add({
            type: 'approval_batch_required',
            runId: input.runId,
            taskId: request.taskId,
            batchId: request.batchId,
            items: request.items,
            createdAt: Date.now(),
            stage: request.stage,
            internal: request.internal
          })
          const decision = approvalResolver(request)
          input.eventCollector.add({
            type: 'approval_batch_decision',
            runId: input.runId,
            taskId: request.taskId,
            batchId: request.batchId,
            decisions: decision.accepted
              ? decision.decisions
              : request.items.map((item) => ({
                  itemId: item.itemId,
                  action: 'reject' as const,
                  message: decision.error
                })),
            decidedAt: Date.now(),
            stage: request.stage,
            internal: request.internal
          })
          return decision
        },
        llmDriver: llmScript
          ? createScriptedStructuredOutputDriver(llmScript)
          : undefined,
        webCrawlerService: contextInput.webCrawlerService
      }
    )

    return contextInput.humanRuntimeOverrides
      ? {
          ...ctx,
          humanRuntimeOverrides: contextInput.humanRuntimeOverrides
        }
      : ctx
  }

  return {
    storageService,
    embeddingService,
    workspaceSourceService,
    workspaceKnowledgePrepareService,
    docxApplyService,
    ensureEmbeddingReady: ensureReady,
    createAiRunContext: createContext,
    createHumanTaskRunner: (contextInput = {}) => {
      const ctx = createContext(contextInput)
      const run = createHumanGraphRunner({ ctx })
      return async (taskInput, options) => {
        await runAiRuntimePreflight({
          ensureEmbeddingReady: ensureReady
        })
        return await run(taskInput, options)
      }
    },
    seedLlmConfig,
    close: async () => {
      await storageService.close()
    }
  }
}
