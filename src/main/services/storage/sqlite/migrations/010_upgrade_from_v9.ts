import fs from 'node:fs'
import type { Migration, MigrationAfterCommitContext } from './types'

const purgeLanceDbDirectory = async (ctx: MigrationAfterCommitContext): Promise<void> => {
  const lanceDbPath = String(ctx.lanceDbPath || '').trim()
  if (!lanceDbPath) return
  fs.rmSync(lanceDbPath, { recursive: true, force: true })
}

export const upgradeFromV9Migration: Migration = {
  version: 10,
  name: 'upgrade_from_v9',
  afterCommit: purgeLanceDbDirectory,
  sql: `
DROP TABLE chat_conversation_memory;
DROP TABLE chat_session_resume_snapshot;
DROP TABLE ai_run_event;
DROP TABLE chat_session_skill_state;
DROP TABLE chat_message;
DROP TABLE chat_session_ui_state;
DROP TABLE ai_run;
DROP TABLE ai_file_change;
DROP TABLE docx_apply;
DROP TABLE chat_session;

CREATE TABLE partner (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_shape TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_viewed_at INTEGER NOT NULL
);
CREATE INDEX idx_partner_pinned
  ON partner(pinned, pinned_at DESC, updated_at DESC);

CREATE TABLE ai_run (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  selected_references_json TEXT,
  attachments_json TEXT,
  model_name TEXT,
  main_model_json TEXT,
  execution_permission TEXT NOT NULL DEFAULT 'review',
  partial_answer TEXT NOT NULL DEFAULT '',
  partial_answer_role TEXT NOT NULL DEFAULT 'answer',
  final_answer TEXT,
  error TEXT,
  failure_code TEXT,
  pending_approval_json TEXT,
  pending_user_takeover_json TEXT,
  artifacts_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (partner_id) REFERENCES partner(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_run_partner_status ON ai_run(partner_id, status);
CREATE INDEX idx_ai_run_partner_created ON ai_run(partner_id, created_at);

CREATE TABLE ai_file_change (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  capability TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  source TEXT,
  before_path TEXT,
  after_path TEXT,
  change_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  before_snapshot_path TEXT,
  after_snapshot_path TEXT,
  before_object_hash TEXT,
  after_object_hash TEXT,
  preview_artifact_hash TEXT,
  before_checksum TEXT,
  after_checksum TEXT,
  preview_path TEXT,
  run_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reverted_at INTEGER,
  last_error TEXT,
  FOREIGN KEY (partner_id) REFERENCES partner(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_file_change_partner ON ai_file_change(partner_id, updated_at);
CREATE INDEX idx_ai_file_change_run ON ai_file_change(run_id, updated_at);

CREATE TABLE docx_apply (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  final_revision_ref TEXT NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  before_exists INTEGER NOT NULL DEFAULT 0,
  before_snapshot_path TEXT,
  before_checksum TEXT,
  before_byte_size INTEGER,
  before_modified_at INTEGER,
  preview_diff_artifact_path TEXT NOT NULL,
  preview_diff_checksum TEXT NOT NULL,
  preview_diff_byte_size INTEGER NOT NULL,
  after_checksum TEXT,
  after_byte_size INTEGER,
  after_modified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reverted_at INTEGER,
  last_error TEXT,
  FOREIGN KEY (partner_id) REFERENCES partner(id) ON DELETE CASCADE
);
CREATE INDEX idx_docx_apply_partner ON docx_apply(partner_id, updated_at);

CREATE TABLE chat_session_message_log (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (partner_id) REFERENCES partner(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chat_session_message_log_partner_seq
  ON chat_session_message_log(partner_id, seq);
CREATE INDEX idx_chat_session_message_log_partner_run
  ON chat_session_message_log(partner_id, run_id);
CREATE INDEX idx_chat_session_message_log_partner_created
  ON chat_session_message_log(partner_id, created_at);

CREATE TABLE scheduled_task (
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
CREATE INDEX idx_scheduled_task_enabled
  ON scheduled_task(enabled, next_run_at);

CREATE TABLE partner_ui_state (
  partner_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (partner_id) REFERENCES partner(id) ON DELETE CASCADE
);

CREATE TABLE workbench_ui_state_v10 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_view_key TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO workbench_ui_state_v10 (id, active_view_key, updated_at)
SELECT 1, NULL, COALESCE((SELECT updated_at FROM workbench_ui_state WHERE id = 1), 0)
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workbench_ui_state');
DROP TABLE workbench_ui_state;
ALTER TABLE workbench_ui_state_v10 RENAME TO workbench_ui_state;

DELETE FROM workspace_file_index;
DELETE FROM workspace_index_job;
DELETE FROM document;

DROP TABLE workspace_source;
CREATE TABLE workspace_source (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_workspace_source_root_path ON workspace_source(root_path);

DROP TABLE web_source;
CREATE TABLE web_source (
  id TEXT PRIMARY KEY,
  identity_kind TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  document_id TEXT,
  index_status TEXT NOT NULL,
  include_selectors_json TEXT,
  exclude_selectors_json TEXT,
  fetched_at INTEGER,
  last_checked_at INTEGER,
  last_crawled_at INTEGER,
  last_indexed_at INTEGER,
  etag TEXT,
  last_modified TEXT,
  content_length INTEGER,
  content_hash TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_web_source_url ON web_source(normalized_url);
CREATE INDEX idx_web_source_document ON web_source(document_id);

CREATE TABLE schema_migration_hooks (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at INTEGER
);
`
}
