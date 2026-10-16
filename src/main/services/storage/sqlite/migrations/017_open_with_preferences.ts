import type { Migration } from './types'
export const openWithPreferencesMigration: Migration = {
  version: 17,
  name: 'open_with_preferences',
  run: (db) => {
    db.exec(
      'CREATE TABLE open_with_preferences (extension TEXT PRIMARY KEY, application_id TEXT NOT NULL)'
    )
  }
}
