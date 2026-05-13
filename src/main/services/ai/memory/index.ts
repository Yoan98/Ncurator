import { z } from 'zod/v4'
import type { ChatSessionMemory } from '../../../types/store'
import { createAiLlmExecutor } from '../llmExecutor'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { LlmConfigStore } from '../../storage/domains/LlmConfigStore'
import { buildSessionMemoryPrompt } from './prompts/session'
import type {
  AiArtifactRef,
  AiLlmIoRecord,
  AiRunEvent,
  AiRuntimeSettings,
  LlmRuntimeConfig,
  SessionTaskArtifact
} from '../../../../shared/types'
import type { AiLlmDriver } from '../llmExecutor'

const rollingSummarySchema = z.object({
  rollingSummary: z.string()
})

const EMPTY_SESSION_MEMORY: ChatSessionMemory = {
  rollingSummary: '',
  recentTaskSummaries: []
}

const SESSION_RECENT_TASK_LIMIT = 5

const toSessionTaskArtifact = (artifact: AiArtifactRef): SessionTaskArtifact =>
  artifact.kind === 'file'
    ? {
        kind: 'file',
        fileName: artifact.fileName,
        path: artifact.path,
        reviewId: artifact.reviewId,
        summary: artifact.summary
      }
    : {
        kind: 'draft_review',
        reviewId: artifact.review.reviewId,
        summary: artifact.summary
      }

export const updateSessionMemoryAfterRun = async (input: {
  runId: string
  sessionId: string
  userInput: string
  assistantOutput: string
  artifacts?: AiArtifactRef[]
  runtimeSettings: AiRuntimeSettings
  chatStore: ChatStore
  llmStore: LlmConfigStore
  modelName: string
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  llmDriver?: AiLlmDriver
}): Promise<void> => {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId) return

  const prev = (await input.chatStore.getSessionMemory(sessionId)) || EMPTY_SESSION_MEMORY

  const activeConfig = await input.llmStore.getActive()
  const modelName = String(input.modelName || '').trim()
  if (!activeConfig || !modelName) return
  let cfg: LlmRuntimeConfig = {
    ...activeConfig,
    model_name: modelName
  }

  const llmExecutor = createAiLlmExecutor({
    eventCtx: {
      runId: input.runId,
      sendEvent: input.sendEvent,
      recordLlmIo: input.recordLlmIo
    },
    runtimeSettings: input.runtimeSettings,
    getConfig: async (): Promise<LlmRuntimeConfig> => cfg,
    saveConfig: async (nextConfig) => {
      cfg = nextConfig
    },
    checkCancelled: () => undefined,
    driver: input.llmDriver
  })

  const result = await llmExecutor.chatStructured({
    caller: 'session.memory',
    schema: rollingSummarySchema,
    schemaName: 'session_memory',
    system: buildSessionMemoryPrompt(),
    user: JSON.stringify({
      previousRollingSummary: prev.rollingSummary,
      recentTaskSummaries: prev.recentTaskSummaries,
      newTask: {
        runId: input.runId,
        userInput: String(input.userInput || ''),
        assistantOutput: String(input.assistantOutput || ''),
        artifacts: (input.artifacts || []).map(toSessionTaskArtifact)
      }
    }),
    temperature: 0.2
  })

  const memory: ChatSessionMemory = {
    rollingSummary: String(result.rollingSummary || '').trim(),
    recentTaskSummaries: [
      ...prev.recentTaskSummaries,
      {
        runId: input.runId,
        userInput: String(input.userInput || ''),
        assistantOutput: String(input.assistantOutput || ''),
        artifacts: (input.artifacts || []).map(toSessionTaskArtifact),
        completedAt: Date.now()
      }
    ].slice(-SESSION_RECENT_TASK_LIMIT)
  }
  await input.chatStore.saveSessionMemory(sessionId, memory)
}
