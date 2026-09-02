import type { LlmRuntimeConfig } from '../../../shared/types'
import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { createAiLlmExecutor } from './llmExecutor'
import { buildReferenceScope } from './human/prompts/referenceScope'
import { getAiRuntimePlatform } from './utils/platform'
import { normalizeSelectedReferences, normalizeWorkspaceBinding } from './utils/runContext'
import type { AiExecutionPermission, AiPreference } from '../../../shared/types'
import { isPathInsideRoot } from './human/tools/terminal/commandPolicy'

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

  const normalizedWorkspace = normalizeWorkspaceBinding(payload.workspace)
  if (!normalizedWorkspace) {
    throw new Error('AI 运行必须绑定工作区，当前请求缺少工作区信息。')
  }
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
    const cfg = await deps.llmStore.getById(configId)
    if (!cfg) throw new Error(`${label}对应的大模型配置不存在，请重新选择`)
    return {
      ...cfg,
      model_name: modelName
    } satisfies LlmRuntimeConfig
  }

  const getRequestedConfig = async () => getModelConfig(payload.mainModel, '主模型')
  let requestedConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedConfig = async () => {
    requestedConfigPromise ||= getRequestedConfig()
    return await requestedConfigPromise
  }

  const llmExecutor = createAiLlmExecutor({
    eventCtx: {
      runId: payload.runId,
      sendEvent: deps.sendEvent,
      recordLlmIo: deps.recordLlmIo
    },
    runtimeSettings: deps.runtimeSettings,
    getConfig: loadRequestedConfig,
    saveConfig: async () => undefined,
    checkCancelled,
    abortSignal: deps.abortSignal,
    driver: deps.llmDriver
  })

  const resolveChatTools = (): AiRunContext['chatTools'] =>
    deps.chatToolsWrapper ? deps.chatToolsWrapper(llmExecutor.chatTools) : llmExecutor.chatTools

  const appendMessageLog: AiRunContext['appendMessageLog'] = async (entries) => {
    await deps.chatMessageLogStore.appendBatch({
      sessionId: payload.sessionId,
      runId: payload.runId,
      entries
    })
  }

  const loadMessageLog: AiRunContext['loadMessageLog'] = async () => {
    return await deps.chatMessageLogStore.list(payload.sessionId)
  }

  return {
    runId: payload.runId,
    sessionId: payload.sessionId,
    runStartedAt: Date.now(),
    platform,
    preference,
    executionPermission,
    humanRuntimeOverrides: deps.humanRuntimeOverrides,
    referenceScope: buildReferenceScope({
      workspace: normalizedWorkspace,
      selectedReferences: normalizedReferences,
      attachments: payload.attachments
    }),
    workspace: normalizedWorkspace,
    checkCancelled,
    chatStructured: llmExecutor.chatStructured,
    chatText: llmExecutor.chatText,
    chatMessages: llmExecutor.chatMessages,
    chatTools: resolveChatTools(),
    sendEvent: deps.sendEvent,
    recordLlmIo: deps.recordLlmIo,
    requestApprovalBatch: deps.requestApprovalBatch,
    getLlmConfig: loadRequestedConfig,
    browserUseService: deps.browserUseService,
    webCrawlerService: deps.webCrawlerService,
    appendMessageLog,
    loadMessageLog,
    trackDocxOpen: ({ docId, sourcePath, replaySession }) => {
      deps.docxApplyService.registerDocxOpen({
        runId: payload.runId,
        docId,
        sourcePath,
        replaySession
      })
    },
    trackDocxChanges: ({ previousDocId, nextDocId, changedNodes, createdNodes, replaySession }) => {
      deps.docxApplyService.registerDocxChanges({
        runId: payload.runId,
        previousDocId,
        nextDocId,
        changedNodes,
        createdNodes,
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
      if (
        normalizedWorkspace?.rootPath &&
        !isPathInsideRoot(record.path, normalizedWorkspace.rootPath)
      ) {
        return
      }
      await deps.saveFileChangeRecord(record, normalizedWorkspace.rootPath)
    },
    listFileChangeRecords: async (input) => {
      return await deps.listFileChangeRecords(input)
    },
    beginTerminalCommandTracking: async (input) => {
      await deps.beginTerminalCommandTracking(input)
    },
    finishTerminalCommandTracking: async (commandId) =>
      await deps.finishTerminalCommandTracking(commandId),
    discardTerminalCommandTracking: (commandId) => {
      deps.discardTerminalCommandTracking(commandId)
    },
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
