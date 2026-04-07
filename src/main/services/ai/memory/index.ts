import { z } from 'zod/v4'
import type { ChatSessionMemory, JsonValue } from '../../../types/store'
import { createAiLlmExecutor } from '../llmExecutor'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { LlmConfigStore } from '../../storage/domains/LlmConfigStore'
import { buildSessionMemoryPrompt } from './prompts/session'
import type { AiLlmIoRecord, AiRunEvent, AiRuntimeSettings, LLMConfig } from '../../../../shared/types'
import type { AiLlmDriver } from '../llmExecutor'

const sessionMemorySchema: z.ZodType<ChatSessionMemory> = z.object({
  summary: z.string(),
  openTasks: z.array(z.string()),
  userPrefs: z.array(z.string()),
  pinnedFacts: z.array(z.string()),
  linkedDocumentIds: z.array(z.string())
})

const EMPTY_SESSION_MEMORY: ChatSessionMemory = {
  summary: '',
  openTasks: [],
  userPrefs: [],
  pinnedFacts: [],
  linkedDocumentIds: []
}

const toList = (value: JsonValue | undefined): string[] =>
  (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)

const normalizeMemory = (input: JsonValue | undefined): ChatSessionMemory => {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    summary: String(obj.summary || '').trim(),
    openTasks: toList(obj.openTasks).slice(0, 20),
    userPrefs: toList(obj.userPrefs).slice(0, 20),
    pinnedFacts: toList(obj.pinnedFacts).slice(0, 20),
    linkedDocumentIds: toList(obj.linkedDocumentIds).slice(0, 50)
  }
}

export const updateSessionMemoryAfterRun = async (input: {
  runId: string
  sessionId: string
  userInput: string
  assistantOutput: string
  runtimeSettings: AiRuntimeSettings
  chatStore: ChatStore
  llmStore: LlmConfigStore
  sendEvent: (event: AiRunEvent) => void
  recordLlmIo?: (record: AiLlmIoRecord) => void
  llmDriver?: AiLlmDriver
}): Promise<void> => {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId) return

  const prev = (await input.chatStore.getSessionMemory(sessionId)) || EMPTY_SESSION_MEMORY

  let cfg = await input.llmStore.getActive()
  if (!cfg) return

  const llmExecutor = createAiLlmExecutor({
    eventCtx: {
      runId: input.runId,
      sendEvent: input.sendEvent,
      recordLlmIo: input.recordLlmIo
    },
    runtimeSettings: input.runtimeSettings,
    getConfig: async (): Promise<LLMConfig> => cfg!,
    saveConfig: async (nextConfig) => {
      await input.llmStore.save(nextConfig)
      cfg = nextConfig
    },
    checkCancelled: () => undefined,
    driver: input.llmDriver
  })

  const result = await llmExecutor.chatStructured({
    caller: 'session.memory',
    schema: sessionMemorySchema,
    schemaName: 'session_memory',
    system: buildSessionMemoryPrompt(),
    user: JSON.stringify({
      previousMemory: prev,
      newExchange: {
        user: String(input.userInput || ''),
        assistant: String(input.assistantOutput || '')
      }
    }),
    temperature: 0.2
  })

  const memory = normalizeMemory(result)
  await input.chatStore.saveSessionMemory(sessionId, memory)
}
