import type { Migration, SqliteDatabase } from './types'

type LegacyRuntimeSettingsRow = {
  systemNotificationsEnabled?: number
}

export const appSettingsMigration: Migration = {
  version: 12,
  name: 'app_settings',
  run: (db: SqliteDatabase) => {
    db.exec(`
CREATE TABLE app_settings (
  id TEXT PRIMARY KEY,
  system_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  knowledge_index_speed TEXT NOT NULL DEFAULT 'slow'
);
`)

    const hasLegacy = Boolean(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_runtime_settings'"
        )
        .get()
    )
    let notificationsEnabled = 1
    if (hasLegacy) {
      const legacy = db
        .prepare('SELECT systemNotificationsEnabled FROM ai_runtime_settings WHERE id = ?')
        .get('singleton') as LegacyRuntimeSettingsRow | undefined
      notificationsEnabled = legacy?.systemNotificationsEnabled === 0 ? 0 : 1
    }
    db.prepare(
      `
INSERT INTO app_settings (id, system_notifications_enabled, knowledge_index_speed)
VALUES ('singleton', ?, 'slow')
`
    ).run(notificationsEnabled)
    if (hasLegacy) db.exec('DROP TABLE ai_runtime_settings')
  }
}
