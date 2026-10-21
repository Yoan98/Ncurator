import type { Migration } from './types'

export const appLanguageAndServiceRouteMigration: Migration = {
  version: 18,
  name: 'app_language_and_service_route',
  run: (db) => {
    db.exec(`
ALTER TABLE app_settings ADD COLUMN language TEXT NOT NULL DEFAULT 'system';
ALTER TABLE app_settings ADD COLUMN service_route TEXT;
`)
    // NULL means not initialized. Main persists the distribution-specific route on first read.
  }
}
