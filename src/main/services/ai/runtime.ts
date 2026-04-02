import type { AiRunContext, AiRunDeps, AiRunStartPayload, CancelledError } from './types'
import { invokeStructuredChat } from './structuredOutput'
import { runStructuredChatWithActivity } from './utils/structuredChatActivity'
import { clipText } from './utils/text'
import {
  buildSelectedContextText,
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

  const chatStructured: AiRunContext['chatStructured'] = async <T extends Record<string, unknown>>(
    input
  ): Promise<T> => {
    checkCancelled()
    const cfg = await loadRequestedConfig()
    const result = await runStructuredChatWithActivity<T>({
      ctx: {
        runId: payload.runId,
        sendEvent: deps.sendEvent,
        recordLlmIo: deps.recordLlmIo
      },
      runId: payload.runId,
      system: input.system,
      user: input.user,
      telemetry: {
        caller: input.caller,
        schemaName: input.schemaName,
        modelName: cfg.model_name,
        baseUrl: cfg.base_url,
        attempt: 1
      },
      execute: async () =>
        await invokeStructuredChat({
          caller: input.caller,
          cfg,
          preferredProfile: cfg.preferredStructuredOutputProfile,
          schema: input.schema,
          schemaName: input.schemaName,
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          driver: deps.structuredOutputDriver
        })
    })
    if (
      result.profile !== 'scripted' &&
      cfg.preferredStructuredOutputProfile !== result.profile
    ) {
      const nextConfig = {
        ...cfg,
        preferredStructuredOutputProfile: result.profile
      }
      try {
        await deps.llmStore.save(nextConfig)
        requestedConfigPromise = Promise.resolve(nextConfig)
      } catch (error) {
        console.warn('[AI-RUNTIME] Failed to persist preferred structured output profile', error)
      }
    }
    return result.output
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
    selectedContextText: buildSelectedContextText({
      workspace: normalizedWorkspace,
      selectedReferences: normalizedReferences
    }),
    workspace: normalizedWorkspace,
    checkCancelled,
    chatStructured,
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
    documentsStore: deps.documentsStore,
    embeddingService: deps.embeddingService
  }
}
