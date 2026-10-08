import type { AiRunEvent, AiLlmIoRecord } from '../../../src/shared/types'
import { ChatRunService } from '../../../src/main/services/ai/ChatRunService'
import { AiRunResourceManager } from '../../../src/main/services/ai/run/AiRunResourceManager'
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
  const executionRunId = options.runId || runtime.runId
  const context = runtime.createAiRunContext({ ...options, runId: executionRunId })
  const config = await context.getLlmConfig()
  const files = new AiFileChangeService(runtime.storageService.aiFileChange)
  const payload: AiRunStartPayload = {
    runId: executionRunId,
    ownerRunId: options.ownerRunId,
    partnerId: context.partnerId,
    partnerName: context.partnerName,
    userMessageId: `user-${executionRunId}`,
    assistantMessageId: `assistant-${executionRunId}`,
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
    defaultStreamingMode: options.streamingModeOverride,
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
    requestUserQuestion: context.requestUserQuestion,
    llmDriver: options.llmScript
      ? createScriptedStructuredOutputDriver(options.llmScript)
      : undefined,
    humanRuntimeOverrides: options.humanRuntimeOverrides,
    browserUseService: options.browserUseService,
    webCrawlerService: options.webCrawlerService
  }
  return { payload, deps, events, io, run: () => AiRunService.getInstance().run(payload, deps) }
}

/** Production submission and approval routing; only the model driver can be scripted. */
export const createChatServiceTestRunner = async (
  runtime: BackendTestRuntime,
  options: CreateAiRunContextInput = {}
) => {
  const context = runtime.createAiRunContext(options)
  const config = await context.getLlmConfig()
  const events: AiRunEvent[] = []
  const io: AiLlmIoRecord[] = []
  const files = new AiFileChangeService(runtime.storageService.aiFileChange)
  const service = new ChatRunService({
    partnerStore: runtime.partnerStore,
    chatMessageLogStore: runtime.storageService.chatMessageLog,
    aiRunStore: runtime.storageService.aiRun,
    documentsStore: runtime.documentsStore,
    embeddingService: runtime.embeddingService,
    llmStore: runtime.llmStore,
    workspaceStore: runtime.storageService.workspace,
    workspaceIndexJobStore: runtime.storageService.workspaceIndexJob,
    webSourceStore: runtime.storageService.webSource,
    ensureEmbeddingReady: runtime.ensureEmbeddingReady,
    docxApplyService: runtime.docxApplyService,
    aiFileChangeService: files,
    runResourceManager: new AiRunResourceManager(),
    llmDriver: options.llmScript
      ? createScriptedStructuredOutputDriver(options.llmScript)
      : undefined,
    resolveHumanRuntimeOverrides: () => options.humanRuntimeOverrides,
    broadcastEvent: (event) => {
      events.push(event)
      runtime.eventCollector.add(event)
      options.observeEvent?.(event)
    },
    recordLlmIo: (record) => {
      io.push(record)
      runtime.eventCollector.addLlmIo(record)
    }
  })
  const submit = async () => {
    const response = await service.submit({
      partnerId: context.partnerId,
      contentNodes: options.contentNodes || [
        { kind: 'text', text: options.userInput || '完成当前任务' }
      ],
      executionPermission: options.executionPermission || 'review',
      mainModel: { configId: config.id, modelName: config.model_name || '' }
    })
    if (!response.success || !response.run) throw new Error(response.error || 'submission failed')
    const runId = response.run.id
    // Read the production execution promise so the fixture cannot close storage during cleanup.
    const execution = (
      service as object as { executions: Map<string, Promise<void>> }
    ).executions.get(runId)
    return {
      runId,
      wait: async () => {
        await execution
        return runtime.storageService.aiRun.getRun(runId)
      }
    }
  }
  return { service, submit, events, io, files, partnerId: context.partnerId }
}
