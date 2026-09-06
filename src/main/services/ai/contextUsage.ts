import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from './human/constants'
import { projectMessageLogRecords } from './human/memory/transcript'
import { estimateMessagesForContext } from './human/memory/multimodal'

export const getAiContextUsage = async (input: {
  partnerId: string
  chatMessageLogStore: ChatMessageLogStore
}): Promise<{
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}> => {
  const records = await input.chatMessageLogStore.list(input.partnerId)
  const messages = projectMessageLogRecords(records).messages
  const usedContextTokens = estimateMessagesForContext(messages)
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
