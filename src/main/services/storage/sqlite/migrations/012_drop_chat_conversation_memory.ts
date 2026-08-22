import type { Migration } from './types'

export const dropChatConversationMemoryMigration: Migration = {
  version: 12,
  name: 'drop_chat_conversation_memory',
  sql: `DROP TABLE IF EXISTS chat_conversation_memory;`
}
