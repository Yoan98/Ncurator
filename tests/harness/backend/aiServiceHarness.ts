import type { AiRunEvent, AiLlmIoRecord } from '../../../src/shared/types'
import { AiRunService } from '../../../src/main/services/ai/AiRunService'
import { AiFileChangeService } from '../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { createScriptedStructuredOutputDriver } from './scriptedStructuredOutputDriver'
import type { BackendTestRuntime, CreateAiRunContextInput } from './test-types'
import type { AiRunStartPayload, AiRunDeps } from '../../../src/main/services/ai/types'

/** Uses the same top-level runtime as ChatRunService, including subagent dispatch and cleanup. */
export const createAiServiceTestRunner = async (
  runtime: BackendTestRuntime,
  options: CreateAiRunContextInput & { abortSignal?: AbortSignal } = {}
) => {
  const context = runtime.createAiRunContext(options)
  const config = await context.getLlmConfig()
  const files = new AiFileChangeService(runtime.storageService.aiFileChange)
  const payload: AiRunStartPayload = {
    runId: options.runId || runtime.runId,
    ownerRunId: options.ownerRunId,
    partnerId: context.partnerId,
    partnerName: context.partnerName,
    userMessageId: `user-${runtime.runId}`,
    assistantMessageId: `assistant-${runtime.runId}`,
    input: options.userInput || '完成当前任务',
    workspaceRoots: context.workspaceRoots,
    mainModel: { configId: config.id, modelName: config.model_name || '' },
    preference: context.preference,
    executionPermission: options.executionPermission || 'full_access',
    selectedReferences: options.selectedReferences
  }
  const events: AiRunEvent[] = []
  const io: AiLlmIoRecord[] = []
  const deps: AiRunDeps = {
    llmStore: runtime.llmStore,
    partnerStore: runtime.partnerStore,
    chatMessageLogStore: runtime.storageService.chatMessageLog,
    documentsStore: runtime.documentsStore,
    embeddingService: runtime.embeddingService,
    ensureEmbeddingReady: runtime.ensureEmbeddingReady,
    docxApplyService: runtime.docxApplyService,
    saveFileChangeRecord: (record) => files.saveRecord(record),
    listFileChangeRecords: async (request) => (await files.listRecords(request)).items,
    abortSignal: options.abortSignal,
    isCancelled: () => options.abortSignal?.aborted === true,
    hasPendingUserMessages: options.hasPendingUserMessages,
    waitForPendingUserMessageSubmissions: options.waitForPendingUserMessageSubmissions,
    sendEvent: (event) => {
      events.push(event)
      runtime.eventCollector.add(event)
      options.observeEvent?.(event)
    },
    recordLlmIo: (record) => {
      io.push(record)
      runtime.eventCollector.addLlmIo(record)
    },
    requestApprovalBatch: async (request) => ({
      accepted: true,
      decisions: request.items.map((item) => ({ itemId: item.itemId, action: 'approve' }))
    }),
    llmDriver: options.llmScript
      ? createScriptedStructuredOutputDriver(options.llmScript)
      : undefined,
    humanRuntimeOverrides: options.humanRuntimeOverrides,
    browserUseService: options.browserUseService,
    webCrawlerService: options.webCrawlerService
  }
  return { payload, deps, events, io, run: () => AiRunService.getInstance().run(payload, deps) }
}
