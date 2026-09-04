import type { ChatSearchTurnStore } from '../../../src/main/services/storage/domains/ChatSearchTurnStore'
import type { ChatStore } from '../../../src/main/services/storage/domains/ChatStore'
import type { SeedChatHistoryInput } from './test-types'

export const seedChatHistory = async (input: {
  chatStore: ChatStore
  chatSearchTurnStore: ChatSearchTurnStore
  payload: SeedChatHistoryInput
}): Promise<void> => {
  const createdAt =
    input.payload.createdAt ||
    input.payload.messages[0]?.timestamp ||
    Date.now()

  await input.chatStore.saveChatSession({
    id: input.payload.sessionId,
    title: input.payload.title || input.payload.sessionId,
    created_at: createdAt,
    workspace_id: '',
    pinned: false,
    pinned_at: null
  })

  for (const message of input.payload.messages) {
    await input.chatSearchTurnStore.appendTurn({
      sessionId: input.payload.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.timestamp
    })
  }
}
