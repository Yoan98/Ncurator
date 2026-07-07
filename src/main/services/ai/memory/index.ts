import { z } from 'zod/v4'
import { createAiLlmExecutor } from '../llmExecutor'
import type { LlmConfigStore } from '../../storage/domains/LlmConfigStore'
import { buildConversationMemoryPrompt } from './prompts/conversation'
import type {
  AiLlmIoRecord,
  AiRunEvent,
  AiRuntimeSettings,
  ChatMessage,
  LlmRuntimeConfig
} from '../../../../shared/types'
import type { AiLlmDriver } from '../llmExecutor'
import { formatTurns } from '../utils/runContext'

const summarySchema = z.object({
  summary: z.string()
})

export const CONVERSATION_MEMORY_BATCH_MESSAGES = 12

export const buildConversationMemorySummary = async (input: {
  runId: string
  sessionId: string
  previousSummary: string
  messages: ChatMessage[]
  runtimeSettings: AiRuntimeSettings
  llmStore: LlmConfigStore
  modelName: string
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  abortSignal?: AbortSignal
  llmDriver?: AiLlmDriver
}): Promise<string> => {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId || input.messages.length === 0) return ''

  const activeConfig = await input.llmStore.getActive()
  const modelName = String(input.modelName || '').trim()
  if (!activeConfig || !modelName) return ''
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
    abortSignal: input.abortSignal,
    driver: input.llmDriver
  })

  const prompt = buildConversationMemoryPrompt({
    previousSummary: input.previousSummary,
    turnsText: formatTurns(input.messages)
  })

  const result = await llmExecutor.chatStructured({
    caller: 'conversation.memory',
    schema: summarySchema,
    schemaName: 'conversation_memory',
    system: prompt.system,
    user: prompt.user,
    temperature: 0.2
  })

  return String(result.output.summary || '').trim()
}
