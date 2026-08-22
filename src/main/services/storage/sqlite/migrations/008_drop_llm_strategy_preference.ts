import type { Migration } from './types'

export const dropLlmStrategyPreferenceMigration: Migration = {
  version: 8,
  name: 'drop_llm_strategy_preference',
  sql: `DROP TABLE IF EXISTS llm_strategy_preference;`
}
