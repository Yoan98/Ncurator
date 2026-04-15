import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { createAiLlmExecutor } from './llmExecutor'
import { buildReferenceScope } from './prompts/referenceScope'
import { clipText } from './utils/text'
import {
  formatTurns,
  normalizeSelectedReferences,
  normalizeWorkspaceBinding
} from './utils/runContext'

export const createAiRunContext = (payload: AiRunStartPayload, deps: AiRunDeps): AiRunContext => {
  const checkCancelled = () => {
    if (deps.isCancelled()) {
      const e = new Error('cancelled') as CancelledError
      e.code = 'CANCELLED'
      throw e
    }
  }

  const normalizedWorkspace = normalizeWorkspaceBinding(payload.workspace)
  const normalizedReferences = normalizeSelectedReferences(payload.selectedReferences)

  const getRequestedConfig = async () => {
    const requestedId = String(payload.modelConfigId || '').trim()
    const cfg = requestedId ? await deps.llmStore.getById(requestedId) : await deps.llmStore.getActive()
    if (!cfg) throw new Error('未配置可用的大模型，请先在「大模型配置」中设置并启用一个模型')
    return cfg
  }
  let requestedConfigPromise: ReturnType<typeof getRequestedConfig> | undefined

  const loadRequestedConfig = async () => {
    requestedConfigPromise ||= getRequestedConfig()
    return await requestedConfigPromise
  }

  const saveRequestedConfig = async (nextConfig: Awaited<ReturnType<typeof getRequestedConfig>>) => {
    await deps.llmStore.save(nextConfig)
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
    driver: deps.llmDriver
  })

  const loadHistory: AiRunContext['loadHistory'] = async (limits) => {
    checkCancelled()
    const recentTurns = Math.max(1, Math.min(50, Number(limits?.recentTurns ?? 12)))
    const maxRecentTurnsChars = Math.max(
      500,
      Math.min(20000, Number(limits?.maxRecentTurnsChars ?? 6000))
    )
    const maxSummaryChars = Math.max(200, Math.min(8000, Number(limits?.maxSummaryChars ?? 1200)))

    const messages = await deps.chatStore.getRecentChatMessages(payload.sessionId, recentTurns)
    const recentTurnsText = clipText(formatTurns(messages), maxRecentTurnsChars)

    const memory = await deps.chatStore.getSessionMemory(payload.sessionId)
    const sessionSummaryText = clipText(String(memory?.summary || ''), maxSummaryChars)

    return { recentTurnsText, sessionSummaryText }
  }

  return {
    runId: payload.runId,
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
    requestApproval: deps.requestApproval,
    loadHistory,
    trackDocxOpen: ({ docId, sourcePath }) => {
      deps.draftReviewService.registerDocxOpen({
        runId: payload.runId,
        docId,
        sourcePath
      })
    },
    trackDocxChanges: ({ previousDocId, nextDocId, op, changedBlocks }) => {
      deps.draftReviewService.registerDocxChanges({
        runId: payload.runId,
        previousDocId,
        nextDocId,
        op,
        changedBlocks
      })
    },
    resolveDocxOpenTarget: async (sourcePath) =>
      await deps.draftReviewService.resolveDocxOpenTarget(sourcePath),
    beginDocxReviewRun: () => {
      deps.draftReviewService.beginRun({
        runId: payload.runId,
        sessionId: payload.sessionId,
        inputText: String(payload.input || '')
      })
    },
    finalizeDocxReviewRun: async () => {
      if (!normalizedWorkspace?.rootPath) return []
      return await deps.draftReviewService.finalizeRunReview({
        runId: payload.runId,
        workspaceRootPath: normalizedWorkspace.rootPath
      })
    },
    discardDocxReviewRun: () => {
      deps.draftReviewService.discardRun(payload.runId)
    },
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
