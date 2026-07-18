import type { ChatStore } from '../storage/domains/ChatStore'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from './human/constants'
import { renderConversationMemoryForBrain } from './human/shared/conversationMemoryRenderers'
import { estimateTextTokens } from './human/utils/tokenEstimate'
import { formatTurns } from './utils/runContext'

export const getAiContextUsage = async (input: {
  sessionId: string
  chatStore: ChatStore
}): Promise<{
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}> => {
  const { memory, recentMessages: messages } = await input.chatStore.getConversationMemoryContext(
    input.sessionId
  )
  const baseText = [
    renderConversationMemoryForBrain(memory),
    formatTurns(messages)
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
