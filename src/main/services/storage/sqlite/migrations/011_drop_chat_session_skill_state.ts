import type { Migration } from './types'

export const dropChatSessionSkillStateMigration: Migration = {
  version: 11,
  name: 'drop_chat_session_skill_state',
  sql: `
DROP TABLE IF EXISTS chat_session_skill_state;
`
}
