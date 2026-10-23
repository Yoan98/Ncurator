import type { Migration } from './types'

export const embeddingModelsMigration: Migration = {
  version: 20,
  name: 'embedding_models',
  sql: `
ALTER TABLE document ADD COLUMN embedding_identity TEXT NOT NULL DEFAULT 'local:jinaai/jina-embeddings-v2-base-zh';
ALTER TABLE document ADD COLUMN embedding_dim INTEGER NOT NULL DEFAULT 768;
ALTER TABLE document ADD COLUMN embedding_error TEXT;
CREATE TABLE embedding_settings (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  settings_json TEXT NOT NULL
);
`
}
