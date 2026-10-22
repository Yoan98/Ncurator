import type { Migration } from './types'

export const userSkillsMigration: Migration = {
  version: 19,
  name: 'user_skills',
  sql: `
CREATE TABLE user_skill (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  directory_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE partner_user_skill (
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES user_skill(id) ON DELETE CASCADE,
  PRIMARY KEY (partner_id, skill_id)
);
CREATE INDEX idx_partner_user_skill_asset ON partner_user_skill(skill_id);
`
}
