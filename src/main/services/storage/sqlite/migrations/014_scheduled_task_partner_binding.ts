import type { Migration } from './types'

export const scheduledTaskPartnerBindingMigration: Migration = {
  version: 14,
  name: 'scheduled_task_partner_binding',
  run: (db) => {
    db.exec(`
      CREATE TABLE scheduled_task_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        content_nodes_json TEXT NOT NULL DEFAULT '[]',
        selected_references_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 0,
        schedule_type TEXT NOT NULL DEFAULT 'daily',
        time_of_day TEXT NOT NULL DEFAULT '09:00',
        weekday INTEGER,
        partner_id TEXT NOT NULL DEFAULT '',
        next_run_at INTEGER,
        busy_cancel_notice_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO scheduled_task_next (
        id, name, description, content_nodes_json, selected_references_json, enabled, schedule_type, time_of_day, weekday, partner_id,
        next_run_at, busy_cancel_notice_at, created_at, updated_at
      )
      SELECT id, name, prompt, '[]', '[]', 0, schedule_type, time_of_day, weekday,
        CASE WHEN EXISTS (SELECT 1 FROM partner WHERE partner.id = scheduled_task.partner_id)
          THEN scheduled_task.partner_id ELSE '' END,
        NULL, NULL, created_at, updated_at
      FROM scheduled_task;
      DROP TABLE scheduled_task;
      ALTER TABLE scheduled_task_next RENAME TO scheduled_task;
      CREATE INDEX idx_scheduled_task_enabled ON scheduled_task(enabled, next_run_at);
    `)
  }
}
