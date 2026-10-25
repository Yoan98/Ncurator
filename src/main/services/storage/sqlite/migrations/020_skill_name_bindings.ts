import type { Migration } from './types'

export const skillNameBindingsMigration: Migration = {
  version: 20,
  name: 'skill_name_bindings',
  sql: `
CREATE TABLE partner_skill_names (
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (partner_id, skill_name)
);
INSERT INTO partner_skill_names (partner_id, skill_name)
SELECT binding.partner_id, skill.name
FROM partner_user_skill binding JOIN user_skill skill ON skill.id = binding.skill_id;
DROP TABLE partner_user_skill;
DROP TABLE user_skill;
ALTER TABLE partner_skill_names RENAME TO partner_user_skill;
CREATE INDEX idx_partner_user_skill_name ON partner_user_skill(skill_name);
`
}
