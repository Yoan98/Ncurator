import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ChatSessionMemory, JsonObject, JsonValue } from '../../types/store'
import type { ChatStore } from '../storage/domains/ChatStore'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import { createChatModel } from '../llm/chatModel'

const parseJsonObject = <T extends JsonObject>(text: string): T => {
  const trimmed = String(text || '').trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    void err
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1)
    return JSON.parse(slice) as T
  }
  throw new Error('无法解析 JSON 输出')
}

const toList = (value: JsonValue | undefined): string[] =>
  (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)

const normalizeMemory = (input: JsonValue | undefined): ChatSessionMemory => {
  const obj: JsonObject = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
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

  const prev = (await input.chatStore.getSessionMemory(sessionId)) || {
    summary: '',
    openTasks: [],
    userPrefs: [],
    pinnedFacts: [],
    linkedDocumentIds: []
  }

  const cfg = await input.llmStore.getActive()
  if (!cfg) return

  const model = createChatModel(cfg, { temperature: 0.2 })
  const res = await model.invoke([
    new SystemMessage(
      [
        'You update session memory for a desktop chat assistant.',
        'Return JSON only with keys:',
        'summary, openTasks, userPrefs, pinnedFacts, linkedDocumentIds.',
        'Do not include secrets or credentials.',
        'Keep summary concise.',
        'Use arrays of short strings.'
      ].join('\n')
    ),
    new HumanMessage(
      JSON.stringify({
        previousMemory: prev,
        newExchange: {
          user: String(input.userInput || ''),
          assistant: String(input.assistantOutput || '')
        }
      })
    )
  ])
  const text = typeof res?.content === 'string' ? res.content : String(res?.content ?? '')
  if (!text) return
  const json = parseJsonObject<JsonObject>(text)
  const memory = normalizeMemory(json)
  await input.chatStore.saveSessionMemory(sessionId, memory)
}
