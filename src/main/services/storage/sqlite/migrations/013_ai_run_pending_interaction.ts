import type { Migration } from './types'

export const aiRunPendingInteractionMigration: Migration = {
  version: 13,
  name: 'ai_run_pending_interaction',
  sql: `ALTER TABLE ai_run ADD COLUMN pending_interaction_json TEXT;`
}
