import type { Migration } from './types'

export const upgradeFromV9Migration: Migration = {
  version: 10,
  name: 'upgrade_from_v9',
  sql: `
CREATE TABLE scheduled_task (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  time_of_day TEXT NOT NULL DEFAULT '09:00',
  weekday INTEGER,
  workspace_id TEXT NOT NULL DEFAULT '',
  main_model_config_id TEXT NOT NULL DEFAULT '',
  main_model_name TEXT NOT NULL DEFAULT '',
  ai_preference TEXT NOT NULL DEFAULT 'default',
  execution_permission TEXT NOT NULL DEFAULT 'full_access',
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_scheduled_task_enabled
  ON scheduled_task(enabled, next_run_at);

CREATE TABLE chat_session_message_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chat_session_message_log_session_seq
  ON chat_session_message_log(session_id, seq);
CREATE INDEX idx_chat_session_message_log_session_run
  ON chat_session_message_log(session_id, run_id);
CREATE INDEX idx_chat_session_message_log_session_created
  ON chat_session_message_log(session_id, created_at);

DROP TABLE chat_conversation_memory;
DROP TABLE chat_session_resume_snapshot;
DROP TABLE ai_run_event;
ALTER TABLE ai_run DROP COLUMN event_count;
ALTER TABLE ai_run DROP COLUMN visible_event_count;
ALTER TABLE ai_run DROP COLUMN last_event_at;
ALTER TABLE ai_run DROP COLUMN vision_model_json;
ALTER TABLE ai_run ADD COLUMN failure_code TEXT;
ALTER TABLE ai_run ADD COLUMN partial_answer_role TEXT NOT NULL DEFAULT 'answer';
`
}
