import type { Migration } from './types'

export const aiRuntimeSystemNotificationsMigration: Migration = {
  version: 2,
  name: 'ai_runtime_system_notifications',
  sql: `ALTER TABLE ai_runtime_settings ADD COLUMN systemNotificationsEnabled INTEGER NOT NULL DEFAULT 1;`
}
