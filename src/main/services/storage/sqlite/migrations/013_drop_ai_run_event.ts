import type { Migration } from './types'

export const dropAiRunEventMigration: Migration = {
  version: 13,
  name: 'drop_ai_run_event',
  run: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS ai_run_event;
      ALTER TABLE ai_run DROP COLUMN event_count;
      ALTER TABLE ai_run DROP COLUMN visible_event_count;
      ALTER TABLE ai_run DROP COLUMN last_event_at;
    `)
  }
}
