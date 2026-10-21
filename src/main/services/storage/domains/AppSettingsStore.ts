import { AppSettingsError } from '../../../../shared/appErrors'
import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import {
  isAppLanguage,
  isServiceRoute,
  type AppDistribution
} from '../../../../shared/appPreferences'
import { getAppRuntime } from '../../app/AppRuntime'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'
type AppSettingsRow = {
  system_notifications_enabled: number
  knowledge_index_speed: string
  language: string
  service_route: string | null
}
const normalizeIndexSpeed = (value: string | undefined): KnowledgeIndexSpeed =>
  value === 'fast' ? 'fast' : 'slow'

export class AppSettingsStore {
  public constructor(
    private readonly sqlite: SqliteCore,
    private readonly distribution: AppDistribution = getAppRuntime().distribution
  ) {}

  public async get(): Promise<AppSettings> {
    this.sqlite.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (?)').run(SETTINGS_ROW_ID)
    const row = this.sqlite
      .prepare('SELECT * FROM app_settings WHERE id = ?')
      .get(SETTINGS_ROW_ID) as AppSettingsRow
    const serviceRoute = isServiceRoute(row.service_route) ? row.service_route : this.distribution
    const language = isAppLanguage(row.language) ? row.language : 'system'
    if (row.service_route !== serviceRoute || row.language !== language) {
      this.sqlite
        .prepare('UPDATE app_settings SET service_route = ?, language = ? WHERE id = ?')
        .run(serviceRoute, language, SETTINGS_ROW_ID)
    }
    return {
      systemNotificationsEnabled: row.system_notifications_enabled !== 0,
      knowledgeIndexSpeed: normalizeIndexSpeed(row.knowledge_index_speed),
      language,
      serviceRoute
    }
  }

  public async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (patch.language !== undefined && !isAppLanguage(patch.language))
      throw new AppSettingsError('invalid_language')
    if (patch.serviceRoute !== undefined && !isServiceRoute(patch.serviceRoute))
      throw new AppSettingsError('invalid_service_route')
    if (
      patch.knowledgeIndexSpeed !== undefined &&
      !['slow', 'fast'].includes(patch.knowledgeIndexSpeed)
    ) {
      throw new AppSettingsError('invalid_index_speed')
    }
    if (
      patch.systemNotificationsEnabled !== undefined &&
      typeof patch.systemNotificationsEnabled !== 'boolean'
    ) {
      throw new AppSettingsError('invalid_notification_setting')
    }
    await this.get()
    this.sqlite
      .prepare(
        `
      UPDATE app_settings SET
        system_notifications_enabled = COALESCE(@notifications, system_notifications_enabled),
        knowledge_index_speed = COALESCE(@speed, knowledge_index_speed),
        language = COALESCE(@language, language), service_route = COALESCE(@route, service_route)
      WHERE id = @id
    `
      )
      .run({
        id: SETTINGS_ROW_ID,
        notifications:
          patch.systemNotificationsEnabled === undefined
            ? null
            : patch.systemNotificationsEnabled
              ? 1
              : 0,
        speed: patch.knowledgeIndexSpeed ?? null,
        language: patch.language ?? null,
        route: patch.serviceRoute ?? null
      })
    return this.get()
  }
}
