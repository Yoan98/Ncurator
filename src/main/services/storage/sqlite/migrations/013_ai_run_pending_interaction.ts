import type { Migration, SqliteDatabase } from './types'

export const aiRunPendingInteractionMigration: Migration = {
  version: 13,
  name: 'ai_run_pending_interaction',
  run: (db: SqliteDatabase) => {
    const columns = db.prepare('PRAGMA table_info(ai_run)').all() as Array<{ name?: unknown }>
    if (columns.some((column) => column.name === 'pending_interaction_json')) return
    db.exec('ALTER TABLE ai_run ADD COLUMN pending_interaction_json TEXT')
  }
}
