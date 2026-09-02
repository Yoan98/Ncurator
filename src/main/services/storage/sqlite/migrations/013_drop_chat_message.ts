import type { Migration } from './types'

export const dropChatMessageMigration: Migration = {
  version: 13,
  name: 'drop_chat_message',
  sql: `
DROP TABLE IF EXISTS chat_message;
`
}
