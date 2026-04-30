import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createHumanGraphRunner } from '../../../src/main/services/ai/human/graph/humanGraph'
import { FileReviewService } from '../../../src/main/services/ai/human/tools/docx/review/FileReviewService'
import { createAiRunContext } from '../../../src/main/services/ai/runtime'
import { runAiRuntimePreflight } from '../../../src/main/services/ai/runtimePreflight'
import type { AiApprovalDecision, AiApprovalRequest } from '../../../src/main/services/ai/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { ModelService } from '../../../src/main/services/model/ModelService'
import { StorageService } from '../../../src/main/services/storage/StorageService'
import { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import { ensureEmbeddingReady } from '../../../src/main/services/vector/ensureEmbeddingReady'
import type { AiRuntimeSettings } from '../../../src/shared/types'
import type { BackendHarnessMode, CreateAiRunContextInput, LiveLlmConfig } from './test-types'
import type { EventCollector } from '../core/eventCollector'
import { createScriptedStructuredOutputDriver } from './scriptedStructuredOutputDriver'

const SCRIPTED_LLM_CONFIG: LiveLlmConfig = {
  id: 'mock-llm-scripted',
  name: 'Mock LLM Scripted',
  base_url: 'https://scripted.local/v1',
  model_name: 'scripted-llm',
  api_key: 'scripted',
  is_active: true
}

const DEFAULT_RUNTIME_SETTINGS: AiRuntimeSettings = {
  llmStreamingMode: 'force_stream'
}

const buildApprovalResolver = (
  policy: CreateAiRunContextInput['approvalPolicy']
): ((request: AiApprovalRequest) => AiApprovalDecision) => {
  if (typeof policy === 'function') return policy
  if (policy === 'deny-all') {
    return () => ({ approved: false, reason: 'approval denied by test policy: deny-all' })
  }
  if (policy === 'deny-medium-high') {
    return () => ({ approved: false, reason: 'approval denied by test policy: deny-medium-high' })
  }
  return () => ({ approved: true })
}

export type RealAiDepsFactory = {
  storageService: StorageService
  embeddingService: EmbeddingService
  fileReviewService: FileReviewService
  ensureEmbeddingReady: () => Promise<void>
  createAiRunContext: (input?: CreateAiRunContextInput) => AiRunContext
  createHumanTaskRunner: (input?: CreateAiRunContextInput) => ReturnType<typeof createHumanGraphRunner>
  seedLlmConfig: (config: LiveLlmConfig) => Promise<void>
  close: () => Promise<void>
}

export const createRealAiDepsFactory = async (input: {
  mode: BackendHarnessMode
  runId: string
  workspaceRoot: string
  eventCollector: EventCollector
}): Promise<RealAiDepsFactory> => {
  const storageService = new StorageService({
    dbPath: path.join(input.workspaceRoot, '.ncurator-test', 'lancedb')
  })
  await storageService.initialize()

  const embeddingService = new EmbeddingService()
  const modelService = ModelService.getInstance()

  const fileReviewService = new FileReviewService(
    storageService.fileReview,
    storageService.documents
  )

  const seedLlmConfig = async (config: LiveLlmConfig): Promise<void> => {
    await storageService.llm.save(config)
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
        modelConfigId: contextInput.modelConfigId,
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
        fileReviewService,
        isCancelled: contextInput.checkCancelledOverride || (() => false),
        sendEvent: (event) => input.eventCollector.add(event),
        recordLlmIo: (record) => input.eventCollector.addLlmIo(record),
        requestApproval: async (request) => {
          const approvalId = randomUUID()
          input.eventCollector.add({
            type: 'approval_required',
            runId: input.runId,
            taskId: request.taskId,
            approvalId,
            command: request.command,
            riskLevel: request.riskLevel,
            reason: request.reason,
            createdAt: Date.now(),
            stage: request.stage,
            internal: request.internal
          })
          const decision = approvalResolver(request)
          input.eventCollector.add({
            type: 'approval_decision',
            runId: input.runId,
            taskId: request.taskId,
            approvalId,
            approved: decision.approved,
            reason: decision.reason,
            decidedAt: Date.now(),
            stage: request.stage,
            internal: request.internal
          })
          return decision
        },
        llmDriver: llmScript
          ? createScriptedStructuredOutputDriver(llmScript)
          : undefined
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
    fileReviewService,
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
