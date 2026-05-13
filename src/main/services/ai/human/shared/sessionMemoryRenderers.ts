import type { ChatSessionMemory } from '../../../../../shared/types'

export const renderSessionMemoryForBrain = (memory: ChatSessionMemory | null): string => {
  if (!memory) return 'none'
  const summary = String(memory.rollingSummary || '').trim()
  return `rollingSummary：\n${summary || 'none'}`
}
