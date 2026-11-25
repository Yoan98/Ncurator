import type { Migration } from './types'

export const partnerMemoryMigration: Migration = {
  version: 25,
  name: 'partner_memory',
  sql: `
    CREATE TABLE partner_memory (
      partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('cooperation_preferences', 'project_background')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      confirmed TEXT NOT NULL DEFAULT '',
      draft TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (partner_id, category)
    );
    INSERT INTO partner_memory (partner_id, category)
      SELECT id, 'cooperation_preferences' FROM partner;
    INSERT INTO partner_memory (partner_id, category)
      SELECT id, 'project_background' FROM partner;
  `
}
