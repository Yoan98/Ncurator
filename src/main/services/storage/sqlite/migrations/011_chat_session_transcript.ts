import type { Migration } from './types'

export const chatSessionTranscriptMigration: Migration = {
  version: 11,
  name: 'chat_session_transcript',
  sql: `
CREATE TABLE IF NOT EXISTS chat_session_transcript (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_session_transcript_session_seq ON chat_session_transcript(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_chat_session_transcript_session_run ON chat_session_transcript(session_id, run_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_transcript_session_created ON chat_session_transcript(session_id, created_at);
`
}
