import { z } from 'zod/v4'
import type { ChatConversationMemory } from '../../../types/store'
import { createAiLlmExecutor } from '../llmExecutor'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { LlmConfigStore } from '../../storage/domains/LlmConfigStore'
import { buildConversationMemoryPrompt } from './prompts/conversation'
import type {
  AiArtifactRef,
  AiLlmIoRecord,
  AiRunEvent,
  AiRuntimeSettings,
  LlmRuntimeConfig
} from '../../../../shared/types'
import type { AiLlmDriver } from '../llmExecutor'

const summarySchema = z.object({
  summary: z.string()
})

const EMPTY_CONVERSATION_MEMORY: ChatConversationMemory = {
  summary: ''
}

export const updateConversationMemoryAfterRun = async (input: {
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

  const prev = (await input.chatStore.getConversationMemory(sessionId)) || EMPTY_CONVERSATION_MEMORY

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

  const prompt = buildConversationMemoryPrompt({
    previousSummary: prev.summary,
    latestUserMessage: String(input.userInput || ''),
    latestAssistantMessage: String(input.assistantOutput || ''),
    latestArtifacts: input.artifacts || []
  })

  const result = await llmExecutor.chatStructured({
    caller: 'conversation.memory',
    schema: summarySchema,
    schemaName: 'conversation_memory',
    system: prompt.system,
    user: prompt.user,
    temperature: 0.2
  })

  const memory: ChatConversationMemory = {
    summary: String(result.output.summary || '').trim()
  }
  await input.chatStore.saveConversationMemory(sessionId, memory)
}
