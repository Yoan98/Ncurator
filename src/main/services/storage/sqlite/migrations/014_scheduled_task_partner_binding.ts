import type { Migration } from './types'

export const scheduledTaskPartnerBindingMigration: Migration = {
  version: 14,
  name: 'scheduled_task_partner_binding',
  run: (db) => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(scheduled_task)').all() as Array<{ name?: unknown }>).map(
        (column) => String(column.name || '')
      )
    )
    if (columns.size === 0) return
    const descriptionExpression = columns.has('description') ? 'description' : 'prompt'
    const contentNodesExpression = columns.has('content_nodes_json') ? 'content_nodes_json' : "'[]'"
    const referencesExpression = columns.has('selected_references_json')
      ? 'selected_references_json'
      : "'[]'"
    const partnerExpression = columns.has('partner_id') ? 'partner_id' : "''"
    db.exec('ALTER TABLE scheduled_task RENAME TO scheduled_task_legacy')
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
      SELECT id, name, ${descriptionExpression}, ${contentNodesExpression}, ${referencesExpression}, 0, schedule_type, time_of_day, weekday,
        CASE WHEN EXISTS (SELECT 1 FROM partner WHERE partner.id = ${partnerExpression})
          THEN ${partnerExpression} ELSE '' END,
        NULL, NULL, created_at, updated_at
      FROM scheduled_task_legacy;
      DROP TABLE scheduled_task_legacy;
      ALTER TABLE scheduled_task_next RENAME TO scheduled_task;
      CREATE INDEX idx_scheduled_task_enabled ON scheduled_task(enabled, next_run_at);
    `)
  }
}
