import type { Migration } from './types'

export const aiRunPendingMessagesMigration: Migration = {
  version: 15,
  name: 'ai_run_pending_messages',
  sql: `ALTER TABLE ai_run ADD COLUMN pending_messages_json TEXT;`
}
