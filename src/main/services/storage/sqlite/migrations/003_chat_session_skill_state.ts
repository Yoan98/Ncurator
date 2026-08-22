import type { Migration } from './types'

export const chatSessionSkillStateMigration: Migration = {
  version: 3,
  name: 'chat_session_skill_state',
  sql: `
CREATE TABLE IF NOT EXISTS chat_session_skill_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
`
}
