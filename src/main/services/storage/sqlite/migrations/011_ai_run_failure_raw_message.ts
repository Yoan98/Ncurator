import type { Migration } from './types'

export const aiRunFailureRawMessageMigration: Migration = {
  version: 11,
  name: 'ai_run_failure_raw_message',
  sql: `ALTER TABLE ai_run ADD COLUMN failure_raw_message TEXT;`
}
