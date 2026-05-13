import type { ChatStore } from '../storage/domains/ChatStore'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from './human/constants'
import { renderSessionMemoryForBrain } from './human/shared/sessionMemoryRenderers'
import { estimateTextTokens } from './human/utils/tokenEstimate'

export const getAiContextUsage = async (input: {
  sessionId: string
  chatStore: ChatStore
}): Promise<{
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}> => {
  const memory = await input.chatStore.getSessionMemory(input.sessionId)
  const messages = await input.chatStore.getRecentChatMessages(input.sessionId, 12)
  const baseText = [
    renderSessionMemoryForBrain(memory),
    messages.map((message) => `${message.role}: ${message.content}`).join('\n')
  ].join('\n\n')
  const usedContextTokens = estimateTextTokens(baseText)
  const contextWindowTokens = DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
  return {
    contextWindowTokens,
    usedContextTokens,
    ratio: usedContextTokens / contextWindowTokens,
    updatedAt: Date.now()
  }
}

export const getContextCompactionTriggerTokens = (): number =>
  Math.floor(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS * CONTEXT_COMPACTION_TRIGGER_RATIO)
