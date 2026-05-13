import type { ChatConversationMemory } from '../../../../../shared/types'

export const renderConversationMemoryForBrain = (memory: ChatConversationMemory | null): string => {
  if (!memory) return 'none'
  const summary = String(memory.summary || '').trim()
  return `summary：\n${summary || 'none'}`
}
