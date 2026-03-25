import { z } from 'zod/v4'
import type { ChatSessionMemory, JsonValue } from '../../../types/store'
import type { ChatStore } from '../../storage/domains/ChatStore'
import type { LlmConfigStore } from '../../storage/domains/LlmConfigStore'
import { invokeStructuredChat } from '../structuredOutput'
import { buildSessionMemoryPrompt } from './prompts/session'

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
  sessionId: string
  userInput: string
  assistantOutput: string
  chatStore: ChatStore
  llmStore: LlmConfigStore
}): Promise<void> => {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId) return

  const prev = (await input.chatStore.getSessionMemory(sessionId)) || EMPTY_SESSION_MEMORY

  const cfg = await input.llmStore.getActive()
  if (!cfg) return

  const memory = normalizeMemory(
    await invokeStructuredChat({
      caller: 'session.memory',
      cfg,
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
  )
  await input.chatStore.saveSessionMemory(sessionId, memory)
}
