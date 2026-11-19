import type { Migration } from './types'

export const appThemeMigration: Migration = {
  version: 23,
  name: 'app_theme',
  sql: `
ALTER TABLE app_settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'system';
`
}
