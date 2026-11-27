import type { Migration } from './types'

export const skillIdentityMigration: Migration = {
  version: 26,
  name: 'skill_identity',
  sql: `
CREATE TABLE skill_identity (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 official_id TEXT UNIQUE,
 display_name TEXT,
 version TEXT,
 baseline_sha256 TEXT
);
INSERT INTO skill_identity (id,name)
 SELECT 'local:' || lower(hex(randomblob(16))),skill_name FROM partner_user_skill GROUP BY skill_name;
CREATE TABLE partner_skill_identity (
 partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
 skill_id TEXT NOT NULL REFERENCES skill_identity(id) ON DELETE CASCADE,
 PRIMARY KEY(partner_id,skill_id)
);
INSERT INTO partner_skill_identity SELECT binding.partner_id,identity.id
 FROM partner_user_skill binding JOIN skill_identity identity ON identity.name=binding.skill_name;
DROP TABLE partner_user_skill;
ALTER TABLE partner_skill_identity RENAME TO partner_user_skill;
CREATE INDEX idx_partner_user_skill_identity ON partner_user_skill(skill_id);
`
}
