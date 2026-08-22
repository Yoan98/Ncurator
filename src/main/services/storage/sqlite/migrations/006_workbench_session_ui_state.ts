import type { Migration } from './types'

export const workbenchSessionUiStateMigration: Migration = {
  version: 6,
  name: 'workbench_session_ui_state',
  sql: `
CREATE TABLE IF NOT EXISTS chat_session_ui_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workbench_ui_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_view_key TEXT,
  draft_state_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_tab_state (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL DEFAULT '',
  zoom_factor REAL NOT NULL DEFAULT 1,
  history_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_tab_state_owner
  ON browser_tab_state(owner_key, position, created_at);
`
}
