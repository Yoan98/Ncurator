import type { Migration } from './types'

export const chatSearchTurnMigration: Migration = {
  version: 12,
  name: 'chat_search_turn',
  sql: `
CREATE TABLE chat_search_turn (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  search_document_ids_json TEXT,
  result_payload_json TEXT,
  content_nodes_json TEXT,
  selected_references_json TEXT,
  attachments_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chat_search_turn_session_seq
  ON chat_search_turn(session_id, seq);
`
}
