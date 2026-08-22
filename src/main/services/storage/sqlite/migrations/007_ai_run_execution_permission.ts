import type { Migration } from './types'

export const aiRunExecutionPermissionMigration: Migration = {
  version: 7,
  name: 'ai_run_execution_permission',
  sql: `ALTER TABLE ai_run ADD COLUMN execution_permission TEXT NOT NULL DEFAULT 'review';`
}
