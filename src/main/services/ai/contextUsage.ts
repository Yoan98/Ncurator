import type { ChatTranscriptStore } from '../storage/domains/ChatTranscriptStore'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from './human/constants'
import { deriveTranscriptMessages } from './human/memory/transcript'
import { extractTextContent } from './structuredOutput'
import { estimateTextTokens } from './human/utils/tokenEstimate'

export const getAiContextUsage = async (input: {
  sessionId: string
  chatTranscriptStore: ChatTranscriptStore
}): Promise<{
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}> => {
  const records = await input.chatTranscriptStore.list(input.sessionId)
  const messages = deriveTranscriptMessages({
    entries: records.map((record) => record.entry)
  })
  const baseText = messages
    .map((message) => extractTextContent(message.content))
    .join('\n\n')
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
