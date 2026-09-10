import { v4 as uuidv4 } from 'uuid'
import type { PartnerStore } from '../../../src/main/services/storage/domains/PartnerStore'
import type { ChatMessageLogStore } from '../../../src/main/services/storage/domains/ChatMessageLogStore'
import type { SeedChatHistoryInput } from './test-types'

export const seedChatHistory = async (input: {
  partnerStore: PartnerStore
  chatMessageLogStore: ChatMessageLogStore
  payload: SeedChatHistoryInput
}): Promise<void> => {
  const partnerId = String(input.payload.partnerId || input.payload.sessionId || '').trim()
  if (!partnerId) throw new Error('partnerId is required')
  const createdAt =
    input.payload.createdAt ||
    input.payload.messages[0]?.timestamp ||
    Date.now()

  await input.partnerStore.savePartner({
    id: partnerId,
    name: input.payload.title || partnerId,
    avatar_shape: 'circle',
    avatar_color: 'blue',
    created_at: createdAt,
    updated_at: createdAt,
    last_viewed_at: createdAt,
    pinned: false,
    pinned_at: null
  })

  for (const message of input.payload.messages) {
    await input.chatMessageLogStore.appendBatch({
      partnerId,
      runId: uuidv4(),
      createdAt: message.timestamp || createdAt,
      entries: [
        message.role === 'assistant'
          ? { kind: 'assistant', content: message.content, toolCalls: [] }
          : {
              kind: 'user',
              content: message.content,
              input: message.content,
              context: { selectedReferences: [], attachments: [] }
            }
      ]
    })
  }
}
