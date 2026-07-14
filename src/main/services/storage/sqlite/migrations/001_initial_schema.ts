export const initialSchemaSql = `
CREATE TABLE IF NOT EXISTS chat_session (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_viewed_at INTEGER NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chat_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_nodes_json TEXT,
  selected_references_json TEXT,
  attachments_json TEXT,
  artifacts_json TEXT,
  error INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_message_session_seq ON chat_message(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_chat_message_session_created ON chat_message(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_conversation_memory (
  session_id TEXT PRIMARY KEY,
  memory_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_session_resume_snapshot (
  session_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  user_input TEXT NOT NULL,
  selected_references_json TEXT NOT NULL,
  workspace_json TEXT,
  human_state_json TEXT NOT NULL,
  error_message TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_run (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  selected_references_json TEXT,
  attachments_json TEXT,
  workspace_json TEXT,
  model_name TEXT,
  main_model_json TEXT,
  vision_model_json TEXT,
  partial_answer TEXT NOT NULL DEFAULT '',
  final_answer TEXT,
  error TEXT,
  pending_approval_json TEXT,
  pending_user_takeover_json TEXT,
  artifacts_json TEXT,
  event_count INTEGER,
  visible_event_count INTEGER,
  last_event_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_run_session_status ON ai_run(session_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_run_session_created ON ai_run(session_id, created_at);

CREATE TABLE IF NOT EXISTS ai_run_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ai_run(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_run_event_run_seq ON ai_run_event(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_ai_run_event_session_created ON ai_run_event(session_id, created_at);

CREATE TABLE IF NOT EXISTS ai_file_change (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  capability TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  before_snapshot_path TEXT,
  before_checksum TEXT,
  after_checksum TEXT,
  preview_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reverted_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_file_change_session ON ai_file_change(session_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_file_change_run ON ai_file_change(run_id, updated_at);

CREATE TABLE IF NOT EXISTS docx_apply (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  final_revision_ref TEXT NOT NULL DEFAULT '',
  change_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  before_exists INTEGER NOT NULL DEFAULT 0,
  before_snapshot_path TEXT,
  before_checksum TEXT,
  before_byte_size INTEGER,
  before_modified_at INTEGER,
  preview_diff_artifact_path TEXT NOT NULL DEFAULT '',
  preview_diff_checksum TEXT NOT NULL DEFAULT '',
  preview_diff_byte_size INTEGER NOT NULL DEFAULT 0,
  after_checksum TEXT,
  after_byte_size INTEGER,
  after_modified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reverted_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_docx_apply_session ON docx_apply(session_id, updated_at);

CREATE TABLE IF NOT EXISTS workspace_source (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_file_index (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  name TEXT NOT NULL,
  file_ext TEXT NOT NULL,
  size INTEGER,
  mtime_ms INTEGER,
  content_hash TEXT,
  index_status TEXT NOT NULL,
  document_id TEXT,
  indexed_at INTEGER,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_file_path ON workspace_file_index(workspace_id, relative_path);
CREATE INDEX IF NOT EXISTS idx_workspace_file_status ON workspace_file_index(workspace_id, index_status);

CREATE TABLE IF NOT EXISTS workspace_index_job (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 1,
  step_total INTEGER NOT NULL DEFAULT 1,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  target_ids_json TEXT NOT NULL DEFAULT '[]',
  message TEXT,
  last_error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_workspace_index_job_active ON workspace_index_job(workspace_id, source_kind, status);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  file_path TEXT,
  import_status INTEGER NOT NULL,
  content_hash TEXT,
  active_generation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  last_error TEXT,
  source_id TEXT,
  source_url TEXT,
  source_title TEXT,
  normalized_source_url TEXT,
  fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_document_workspace_type ON document(workspace_id, source_type);
CREATE INDEX IF NOT EXISTS idx_document_generation ON document(workspace_id, active_generation_id);
CREATE INDEX IF NOT EXISTS idx_document_file_path ON document(file_path);

CREATE TABLE IF NOT EXISTS web_source (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_source_url ON web_source(workspace_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_web_source_document ON web_source(document_id);

CREATE TABLE IF NOT EXISTS llm_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  providerKind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_strategy_preference (
  config_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  preferred_transport TEXT NOT NULL,
  preferred_structured_output_mode TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (config_id, model_name)
);

CREATE TABLE IF NOT EXISTS ai_runtime_settings (
  id TEXT PRIMARY KEY,
  llmStreamingMode TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`
