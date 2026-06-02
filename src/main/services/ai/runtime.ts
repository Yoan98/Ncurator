import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { createAiLlmExecutor } from './llmExecutor'
import { buildReferenceScope } from './prompts/referenceScope'
import { getAiRuntimePlatform } from './utils/platform'
import { clipText } from './utils/text'
import {
  formatTurns,
  normalizeSelectedReferences,
  normalizeWorkspaceBinding
} from './utils/runContext'

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.abortSignal?.aborted || deps.isCancelled()) {
      const e = new Error('cancelled') as CancelledError
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

  const getRequestedConfig = async () => {
    const modelName = String(payload.modelName || '').trim()
    if (!modelName) throw new Error('当前配置未获取到可用模型，请先在「大模型」中打开模型列表获取模型')
    const cfg = await deps.llmStore.getActive()
    if (!cfg) throw new Error('未配置可用的大模型，请先在「大模型配置」中设置并启用一个模型')
    return {
      ...cfg,
      model_name: modelName
    }
  }
  let requestedConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedConfig = async () => {
    requestedConfigPromise ||= getRequestedConfig()
    return await requestedConfigPromise
  }

  const saveRequestedConfig = async (nextConfig: Awaited<ReturnType<typeof getRequestedConfig>>) => {
    requestedConfigPromise = Promise.resolve(nextConfig)
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

  const loadConversationContext: AiRunContext['loadConversationContext'] = async (limits) => {
    checkCancelled()
    const recentTurns = Math.max(1, Math.min(50, Number(limits?.recentTurns ?? 12)))
    const maxRecentTurnsChars = Math.max(
      500,
      Math.min(20000, Number(limits?.maxRecentTurnsChars ?? 6000))
    )
    const maxSummaryChars = Math.max(200, Math.min(8000, Number(limits?.maxSummaryChars ?? 1200)))

    const messages = await deps.chatStore.getRecentChatMessages(payload.sessionId, recentTurns)
    const recentTurnsText = clipText(formatTurns(messages), maxRecentTurnsChars)

    const memory = await deps.chatStore.getConversationMemory(payload.sessionId)
    const conversationSummaryText = clipText(String(memory?.summary || ''), maxSummaryChars)

    return { recentTurnsText, conversationSummaryText }
  }

  const loadConversationMemory: AiRunContext['loadConversationMemory'] = async () => {
    checkCancelled()
    return await deps.chatStore.getConversationMemory(payload.sessionId)
  }

  return {
    runId: payload.runId,
    platform,
    referenceScope: buildReferenceScope({
      workspace: normalizedWorkspace,
      selectedReferences: normalizedReferences
    }),
    workspace: normalizedWorkspace,
    checkCancelled,
    chatStructured: llmExecutor.chatStructured,
    chatText: llmExecutor.chatText,
    sendEvent: deps.sendEvent,
    recordLlmIo: deps.recordLlmIo,
    requestApprovalBatch: deps.requestApprovalBatch,
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
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
