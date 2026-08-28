import type { Migration, SqliteDatabase } from './types'

const hasColumn = (db: SqliteDatabase, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column
  )

export const dropVisionModelMigration: Migration = {
  version: 14,
  name: 'drop_vision_model',
  run: (db) => {
    if (hasColumn(db, 'ai_run', 'vision_model_json')) {
      db.exec('ALTER TABLE ai_run DROP COLUMN vision_model_json;')
    }
    if (hasColumn(db, 'scheduled_task', 'vision_model_config_id')) {
      db.exec('ALTER TABLE scheduled_task DROP COLUMN vision_model_config_id;')
    }
    if (hasColumn(db, 'scheduled_task', 'vision_model_name')) {
      db.exec('ALTER TABLE scheduled_task DROP COLUMN vision_model_name;')
    }
  }
}
