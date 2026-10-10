import type { Migration } from './types'

export const subagentSessionsMigration: Migration = {
  version: 16,
  name: 'subagent_sessions',
  sql: `
CREATE TABLE ai_subagent (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_subagent_partner ON ai_subagent(partner_id, created_at);
ALTER TABLE chat_session_message_log ADD COLUMN subagent_id TEXT REFERENCES ai_subagent(id) ON DELETE CASCADE;
DROP INDEX idx_chat_session_message_log_partner_seq;
CREATE UNIQUE INDEX idx_chat_session_message_log_partner_seq ON chat_session_message_log(partner_id, seq) WHERE subagent_id IS NULL;
CREATE UNIQUE INDEX idx_chat_session_message_log_subagent_seq ON chat_session_message_log(subagent_id, seq) WHERE subagent_id IS NOT NULL;
`
}
