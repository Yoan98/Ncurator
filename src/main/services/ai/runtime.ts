import type { LlmRuntimeConfig } from '../../../shared/types'
import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { createAiLlmExecutor } from './llmExecutor'
import { buildReferenceScope } from './prompts/referenceScope'
import { getAiRuntimePlatform } from './utils/platform'
import {
  formatTurns,
  normalizeSelectedReferences,
  normalizeWorkspaceBinding
} from './utils/runContext'

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.abortSignal?.aborted || deps.isCancelled()) {
      const e = new Error('已取消') as CancelledError
      e.code = 'CANCELLED'
      throw e
    }
  }

  const normalizedWorkspace = normalizeWorkspaceBinding(payload.workspace)
  if (!normalizedWorkspace) {
    throw new Error('AI 运行必须绑定工作区，当前请求缺少工作区信息。')
  }
  const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)
  const platform = getAiRuntimePlatform()

  const getModelConfig = async (
    selection: typeof payload.mainModel,
    label: string
  ): Promise<LlmRuntimeConfig> => {
    const configId = String(selection?.configId || '').trim()
    const modelName = String(selection?.modelName || '').trim()
    if (!configId || !modelName) {
      throw new Error(`请先选择${label}`)
    }
    const cfg = await deps.llmStore.getById(configId)
    if (!cfg) throw new Error(`${label}对应的大模型配置不存在，请重新选择`)
    const preference = await deps.llmStrategyPreferenceStore.get({
      configId,
      modelName
    })
    return {
      ...cfg,
      model_name: modelName,
      preferredTransport: preference?.preferredTransport,
      preferredStructuredOutputMode: preference?.preferredStructuredOutputMode
    } satisfies LlmRuntimeConfig
  }

  const getRequestedConfig = async () => getModelConfig(payload.mainModel, '主模型')
  let requestedConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedConfig = async () => {
    requestedConfigPromise ||= getRequestedConfig()
    return await requestedConfigPromise
  }

  const saveRequestedConfig = async (nextConfig: LlmRuntimeConfig) => {
    requestedConfigPromise = Promise.resolve(nextConfig)
    if (nextConfig.preferredTransport && nextConfig.preferredStructuredOutputMode) {
      await deps.llmStrategyPreferenceStore.save({
        configId: nextConfig.id,
        modelName: nextConfig.model_name,
        strategy: {
          transport: nextConfig.preferredTransport,
          mode: nextConfig.preferredStructuredOutputMode
        }
      })
    }
  }

  let requestedVisionConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedVisionConfig = async () => {
    requestedVisionConfigPromise ||= getModelConfig(
      payload.visionModel || payload.mainModel,
      payload.visionModel ? '视觉模型' : '主模型'
    )
    return await requestedVisionConfigPromise
  }

  const llmExecutor = createAiLlmExecutor({
    eventCtx: {
      runId: payload.runId,
      sendEvent: deps.sendEvent,
      recordLlmIo: deps.recordLlmIo
    },
    runtimeSettings: deps.runtimeSettings,
    getConfig: loadRequestedConfig,
    saveConfig: saveRequestedConfig,
    checkCancelled,
    abortSignal: deps.abortSignal,
    driver: deps.llmDriver
  })

  const loadConversationContext: AiRunContext['loadConversationContext'] = async () => {
    checkCancelled()
    const memory = await deps.chatStore.getConversationMemory(payload.sessionId)
    const messages = await deps.chatStore.getMessagesAfterConversationMemory(payload.sessionId)
    const recentTurnsText = formatTurns(messages)
    const conversationSummaryText = String(memory?.summary || '')

    return { recentTurnsText, conversationSummaryText }
  }

  const loadConversationMemory: AiRunContext['loadConversationMemory'] = async () => {
    checkCancelled()
    return await deps.chatStore.getConversationMemory(payload.sessionId)
  }

  return {
    runId: payload.runId,
    sessionId: payload.sessionId,
    platform,
    referenceScope: buildReferenceScope({
      workspace: normalizedWorkspace,
      selectedReferences: normalizedReferences,
      attachments: payload.attachments
    }),
    workspace: normalizedWorkspace,
    checkCancelled,
    chatStructured: llmExecutor.chatStructured,
    chatText: llmExecutor.chatText,
    sendEvent: deps.sendEvent,
    recordLlmIo: deps.recordLlmIo,
    requestApprovalBatch: deps.requestApprovalBatch,
    getLlmConfig: loadRequestedConfig,
    getVisionLlmConfig: loadRequestedVisionConfig,
    browserUseService: deps.browserUseService,
    webCrawlerService: deps.webCrawlerService,
    loadConversationContext,
    loadConversationMemory,
    trackDocxOpen: ({ docId, sourcePath, replaySession }) => {
      deps.docxApplyService.registerDocxOpen({
        runId: payload.runId,
        docId,
        sourcePath,
        replaySession
      })
    },
    trackDocxChanges: ({
      previousDocId,
      nextDocId,
      op,
      changedBlocks,
      createdBlocks,
      replaySession
    }) => {
      deps.docxApplyService.registerDocxChanges({
        runId: payload.runId,
        previousDocId,
        nextDocId,
        op,
        changedBlocks,
        createdBlocks,
        replaySession
      })
    },
    trackDocxBatchChanges: ({
      previousDocId,
      nextDocId,
      ops,
      changedBlocks,
      createdBlocks,
      replaySession
    }) => {
      const op = ops[0]
      if (!op) return
      deps.docxApplyService.registerDocxChanges({
        runId: payload.runId,
        previousDocId,
        nextDocId,
        op,
        changedBlocks,
        createdBlocks,
        replaySession
      })
    },
    resolveDocxOpenTarget: async (sourcePath) =>
      await deps.docxApplyService.resolveDocxOpenTarget(sourcePath),
    beginDocxApplyRun: () => {
      deps.docxApplyService.beginRun({
        runId: payload.runId,
        sessionId: payload.sessionId,
        inputText: String(payload.input || '')
      })
    },
    applyDocxRunEdits: async () => {
      if (!normalizedWorkspace?.rootPath) return []
      return await deps.docxApplyService.applyRunEdits({
        runId: payload.runId,
        workspaceRootPath: normalizedWorkspace.rootPath
      })
    },
    discardDocxApplyRun: () => {
      deps.docxApplyService.discardRun(payload.runId)
    },
    saveFileChangeRecord: async (record) => {
      await deps.saveFileChangeRecord(record)
    },
    listFileChangeRecords: async (input) => {
      return await deps.listFileChangeRecords(input)
    },
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
