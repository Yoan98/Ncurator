import type { Migration } from './types'

type SqliteColumnInfo = {
  name: string
}

export const repairAiRuntimeSystemNotificationsColumnMigration: Migration = {
  version: 9,
  name: 'repair_ai_runtime_system_notifications_column',
  run: (db) => {
    const columns = db.prepare('PRAGMA table_info(ai_runtime_settings)').all() as SqliteColumnInfo[]
    if (columns.some((column) => column.name === 'systemNotificationsEnabled')) return
    db.exec(
      'ALTER TABLE ai_runtime_settings ADD COLUMN systemNotificationsEnabled INTEGER NOT NULL DEFAULT 1;'
    )
  }
}
