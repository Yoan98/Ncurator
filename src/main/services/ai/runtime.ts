import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { invokeStructuredChat } from './structuredOutput'
import { clipText } from './utils/text'
import {
  buildEffectiveDocumentIds,
  buildSelectedScopeSummary,
  formatTurns,
  normalizeSelectedSourceScopes,
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

  const normalizedScopes = normalizeSelectedSourceScopes(payload.selectedSourceScopes)
  const effectiveDocumentIds = buildEffectiveDocumentIds(
    payload.selectedDocumentIds,
    normalizedScopes
  )

  const getActiveConfig = async () => {
    const cfg = await deps.llmStore.getActive()
    if (!cfg) throw new Error('未配置可用的大模型，请先在「大模型配置」中设置并启用一个模型')
    return cfg
  }

  const chatStructured: AiRunContext['chatStructured'] = async <T extends Record<string, unknown>>(
    input
  ): Promise<T> => {
    checkCancelled()
    const cfg = await getActiveConfig()
    return invokeStructuredChat({
      caller: input.caller,
      cfg,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      user: input.user,
      temperature: input.temperature
    })
  }

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
    sessionId: payload.sessionId,
    selectedDocumentIds: effectiveDocumentIds,
    selectedSourceScopes: normalizedScopes,
    selectedScopeSummary: buildSelectedScopeSummary(normalizedScopes, payload.allowNonLocal),
    allowNonLocal: Boolean(payload.allowNonLocal),
    runtimeSettings: deps.runtimeSettings,
    workspace: normalizeWorkspaceBinding(payload.workspace),
    checkCancelled,
    chatStructured,
    sendEvent: deps.sendEvent,
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
    trackDocxPreview: ({ docId, previewPath }) => {
      deps.draftReviewService.registerDocxPreview({
        runId: payload.runId,
        docId,
        previewPath
      })
    },
    getModelConfig: getActiveConfig,
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
