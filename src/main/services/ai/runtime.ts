import { createSqliteTranscript } from './human/memory/sqliteTranscript'
import type { LlmRuntimeConfig } from '../../../shared/types'
import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { createAiLlmExecutor } from './llmExecutor'
import { buildReferenceScope } from './human/prompts/referenceScope'
import { getAiRuntimePlatform } from './utils/platform'
import { normalizeSelectedReferences } from './utils/runContext'
import { KB_INDEXING_IN_PROGRESS_ERROR } from './human/tools/kb/retrievalTools'
import type { AiExecutionPermission, AiPreference } from '../../../shared/types'
import { isFreeModelConfigId } from '../../../shared/freeModels'
import { acquireRunFile } from './run/fileLease'
import { FreeModelCatalogService } from '../llm/FreeModelCatalogService'

const normalizeAiPreference = (value: unknown): AiPreference =>
  value === 'local_sources_relaxed' || value === 'local_sources_strict' ? value : 'default'

const normalizeExecutionPermission = (
  value: AiExecutionPermission | undefined
): AiExecutionPermission => (value === 'full_access' ? 'full_access' : 'review')

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.abortSignal?.aborted || deps.isCancelled()) {
      const e = new Error('已取消') as CancelledError
      e.code = 'CANCELLED'
      throw e
    }
  }

  const workspaceRoots = payload.workspaceRoots
    .map((rootPath) => String(rootPath || '').trim())
    .filter(Boolean)
  const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)
  const platform = getAiRuntimePlatform()
  const preference = normalizeAiPreference(payload.preference)
  const executionPermission = normalizeExecutionPermission(payload.executionPermission)

  const getModelConfig = async (
    selection: typeof payload.mainModel,
    label: string
  ): Promise<LlmRuntimeConfig> => {
    const configId = String(selection?.configId || '').trim()
    const modelName = String(selection?.modelName || '').trim()
    if (!configId || !modelName) {
      throw new Error(`请先选择${label}`)
    }
    if (isFreeModelConfigId(configId)) {
      const freeCfg = await FreeModelCatalogService.getInstance().resolveRuntimeConfig(
        configId,
        modelName
      )
      if (!freeCfg) throw new Error(`${label}对应的免费模型不可用，请重新选择`)
      return freeCfg
    }
    const cfg = await deps.llmStore.getById(configId)
    if (!cfg) throw new Error(`${label}对应的大模型配置不存在，请重新选择`)
    return {
      ...cfg,
      model_name: modelName
    } satisfies LlmRuntimeConfig
  }

  const getRequestedConfig = async () =>
    deps.modelConfig || (await getModelConfig(payload.mainModel, '主模型'))
  let requestedConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedConfig = async () => {
    requestedConfigPromise ||= getRequestedConfig()
    return await requestedConfigPromise
  }

  const llmExecutor = createAiLlmExecutor({
    eventCtx: {
      runId: payload.runId,
      sendEvent: deps.sendEvent,
      recordLlmIo: deps.recordLlmIo,
      abortSignal: deps.abortSignal
    },
    defaultStreamingMode: deps.defaultStreamingMode,
    getConfig: loadRequestedConfig,
    saveConfig: async () => undefined,
    checkCancelled,
    abortSignal: deps.abortSignal,
    driver: deps.llmDriver
  })

  const resolveChatTools = (): AiRunContext['chatTools'] =>
    deps.chatToolsWrapper ? deps.chatToolsWrapper(llmExecutor.chatTools) : llmExecutor.chatTools

  const ownerRunId = payload.ownerRunId || payload.runId
  const touchedPaths = new Set<string>()
  const transcript = createSqliteTranscript(
    deps.chatMessageLogStore,
    {
      partnerId: payload.partnerId,
      subagentId: payload.subagentId
    },
    payload.runId
  )
  const appendMessageLog = transcript.append
  const loadMessageLog = transcript.load

  return {
    ownerRunId,
    listAgents: () => deps.subagentStore.list(payload.partnerId),
    isSubagent: Boolean(payload.parentToolCallId),
    delegateToSubagent:
      deps.delegateToSubagent ||
      (async () => {
        throw new Error('当前运行不支持派发')
      }),
    acquireFile: (sourcePath) => acquireRunFile(payload.runId, sourcePath),
    runId: payload.runId,
    partnerId: payload.partnerId,
    userMessageId: payload.userMessageId,
    partnerName: payload.partnerName,
    workspaceRoots,
    runStartedAt: Date.now(),
    platform,
    preference,
    executionPermission,
    contentNodes: payload.contentNodes,
    humanRuntimeOverrides: deps.humanRuntimeOverrides,
    referenceScope: buildReferenceScope({
      contentNodes: payload.contentNodes,
      selectedReferences: normalizedReferences,
      attachments: payload.attachments
    }),
    checkCancelled,
    hasPendingUserMessages: () => deps.hasPendingUserMessages?.() === true,
    waitForPendingUserMessageSubmissions: async () => {
      await deps.waitForPendingUserMessageSubmissions?.()
    },
    abortSignal: deps.abortSignal,
    chatStructured: llmExecutor.chatStructured,
    chatText: llmExecutor.chatText,
    chatMessages: llmExecutor.chatMessages,
    chatTools: resolveChatTools(),
    sendEvent: deps.sendEvent,
    recordLlmIo: deps.recordLlmIo,
    requestApprovalBatch: deps.requestApprovalBatch,
    requestUserQuestion:
      deps.requestUserQuestion ||
      (async () => ({
        accepted: false as const,
        error: '当前运行不支持用户提问'
      })),
    getLlmConfig: loadRequestedConfig,
    browserUseService:
      deps.browserUseService && payload.parentToolCallId
        ? {
            ...deps.browserUseService,
            createTab: (ownerId) => deps.browserUseService!.createTab(ownerId),
            ensureAutomationTab: (ownerId) => deps.browserUseService!.ensureAutomationTab(ownerId),
            getActiveTabId: () => deps.browserUseService!.getActiveTabId(),
            listTabs: (ownerId) => deps.browserUseService!.listTabs(ownerId),
            run: (request) =>
              deps.browserUseService!.run({
                ...request,
                executionScope: payload.runId,
                background: true
              }),
            navigate: (url, tabId) => deps.browserUseService!.navigate(url, tabId)
          }
        : deps.browserUseService,
    webCrawlerService: deps.webCrawlerService,
    scheduledTaskService: deps.scheduledTaskService,
    appendMessageLog,
    loadMessageLog,
    resolveDocxOpenTarget: async (sourcePath) =>
      await deps.docxApplyService.resolveDocxOpenTarget(sourcePath),
    writeFileChange: async (input) => {
      const result = await deps.docxApplyService.fileChanges.sessions.write(
        payload.partnerId,
        ownerRunId,
        input
      )
      touchedPaths.add(result.record.path)
      return result
    },
    getFileChangeSession: async (sourcePath) =>
      await deps.docxApplyService.fileChanges.sessions.read(
        payload.partnerId,
        ownerRunId,
        sourcePath
      ),
    finalizeRunFileChanges: async () =>
      await deps.docxApplyService.fileChanges.sessions.finalize(payload.partnerId, ownerRunId),
    saveFileChangeRecord: async (record) => {
      touchedPaths.add(record.path)
      record.runId = ownerRunId
      record.partnerId = payload.partnerId
      await deps.saveFileChangeRecord(record)
    },
    listFileChangeRecords: async (input) => {
      const records = await deps.listFileChangeRecords({ runId: ownerRunId })
      return payload.parentToolCallId && input.participatingOnly
        ? records.filter((record) => touchedPaths.has(record.path))
        : records
    },
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService,
    assertKbAvailable: async () => {
      if (await deps.hasRunningKnowledgeIndexJob?.()) {
        throw new Error(KB_INDEXING_IN_PROGRESS_ERROR)
      }
      await deps.ensureEmbeddingReady()
    }
  }
}
