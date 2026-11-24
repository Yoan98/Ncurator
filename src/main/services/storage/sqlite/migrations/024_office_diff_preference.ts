import type { Migration } from './types'

export const officeDiffPreferenceMigration: Migration = {
  version: 24,
  name: 'office_diff_preference',
  sql: 'ALTER TABLE app_settings ADD COLUMN open_office_diff_in_wps INTEGER NOT NULL DEFAULT 0;'
}
