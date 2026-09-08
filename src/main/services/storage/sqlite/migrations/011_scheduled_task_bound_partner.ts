import type { Migration } from './types'

/**
 * scheduled_task：增加 busy_cancel_notice_at；去掉 partner_id 外键 CASCADE，
 * 专属伙伴删除后任务仍保留，由服务层自动重建伙伴。
 */
export const scheduledTaskBoundPartnerMigration: Migration = {
  version: 11,
  name: 'scheduled_task_bound_partner',
  run: (db) => {
    db.exec(`
CREATE TABLE scheduled_task_v11 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  time_of_day TEXT NOT NULL DEFAULT '09:00',
  weekday INTEGER,
  partner_id TEXT NOT NULL,
  main_model_config_id TEXT NOT NULL DEFAULT '',
  main_model_name TEXT NOT NULL DEFAULT '',
  ai_preference TEXT NOT NULL DEFAULT 'default',
  execution_permission TEXT NOT NULL DEFAULT 'full_access',
  next_run_at INTEGER,
  busy_cancel_notice_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO scheduled_task_v11 (
  id, name, prompt, enabled, schedule_type, time_of_day, weekday,
  partner_id, main_model_config_id, main_model_name,
  ai_preference, execution_permission, next_run_at, busy_cancel_notice_at,
  created_at, updated_at
)
SELECT
  id, name, prompt, enabled, schedule_type, time_of_day, weekday,
  partner_id, main_model_config_id, main_model_name,
  ai_preference, execution_permission, next_run_at, NULL,
  created_at, updated_at
FROM scheduled_task;

DROP TABLE scheduled_task;
ALTER TABLE scheduled_task_v11 RENAME TO scheduled_task;

CREATE INDEX idx_scheduled_task_enabled
  ON scheduled_task(enabled, next_run_at);
`)
  }
}
