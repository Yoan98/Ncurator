import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'

const DEFAULT_SETTINGS: AppSettings = {
  systemNotificationsEnabled: true,
  knowledgeIndexSpeed: 'slow'
}

type AppSettingsRow = {
  id?: string
  system_notifications_enabled?: number
  knowledge_index_speed?: string
}

const normalizeIndexSpeed = (value: unknown): KnowledgeIndexSpeed =>
  value === 'fast' ? 'fast' : 'slow'

export class AppSettingsStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async get(): Promise<AppSettings> {
    const row = this.sqlite
      .prepare('SELECT * FROM app_settings WHERE id = ?')
      .get(SETTINGS_ROW_ID) as AppSettingsRow | undefined
    if (!row) return DEFAULT_SETTINGS
    return {
      systemNotificationsEnabled: row.system_notifications_enabled !== 0,
      knowledgeIndexSpeed: normalizeIndexSpeed(row.knowledge_index_speed)
    }
  }

  public async save(settings: AppSettings): Promise<AppSettings> {
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO app_settings (id, system_notifications_enabled, knowledge_index_speed)
        VALUES (@id, @system_notifications_enabled, @knowledge_index_speed)
      `
      )
      .run({
        id: SETTINGS_ROW_ID,
        system_notifications_enabled: settings.systemNotificationsEnabled === false ? 0 : 1,
        knowledge_index_speed: normalizeIndexSpeed(settings.knowledgeIndexSpeed)
      })
    return await this.get()
  }
}
