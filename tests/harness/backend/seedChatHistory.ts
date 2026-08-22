import type { ChatStore } from '../../../src/main/services/storage/domains/ChatStore'
import type { SeedChatHistoryInput } from './test-types'

export const seedChatHistory = async (input: {
  chatStore: ChatStore
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
    workspace_id: ''
  })

  for (const message of input.payload.messages) {
    await input.chatStore.saveChatMessage({
      id: message.id,
      session_id: input.payload.sessionId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      artifacts: message.artifacts,
      error: message.error
    })
  }
}
