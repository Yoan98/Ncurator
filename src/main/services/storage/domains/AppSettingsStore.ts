import { AppSettingsError } from '../../../../shared/appErrors'
import type { AppSettings, KnowledgeIndexSpeed } from '../../../../shared/types'
import {
  isAppLanguage,
  isAppTheme,
  type AppDistribution,
  type AppTheme
} from '../../../../shared/appPreferences'
import { getAppRuntime } from '../../app/AppRuntime'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'
type AppSettingsRow = {
  open_office_diff_in_wps: number
  system_notifications_enabled: number
  knowledge_index_speed: string
  language: string
  theme: string
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
    const serviceRoute = this.distribution
    const language = isAppLanguage(row.language) ? row.language : 'system'
    if (row.language !== language) {
      this.sqlite
        .prepare('UPDATE app_settings SET language = ? WHERE id = ?')
        .run(language, SETTINGS_ROW_ID)
    }
    const theme: AppTheme = isAppTheme(row.theme) ? row.theme : 'system'
    if (row.theme !== theme) {
      this.sqlite
        .prepare('UPDATE app_settings SET theme = ? WHERE id = ?')
        .run(theme, SETTINGS_ROW_ID)
    }
    return {
      openOfficeDiffInWps: row.open_office_diff_in_wps !== 0,
      systemNotificationsEnabled: row.system_notifications_enabled !== 0,
      knowledgeIndexSpeed: normalizeIndexSpeed(row.knowledge_index_speed),
      language,
      theme,
      serviceRoute
    }
  }

  public async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (patch.language !== undefined && !isAppLanguage(patch.language))
      throw new AppSettingsError('invalid_language')
    if (patch.theme !== undefined && !isAppTheme(patch.theme))
      throw new AppSettingsError('invalid_theme')
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
    if (patch.openOfficeDiffInWps !== undefined && typeof patch.openOfficeDiffInWps !== 'boolean')
      throw new Error('Invalid Office diff preference')
    await this.get()
    this.sqlite
      .prepare(
        `
      UPDATE app_settings SET
        open_office_diff_in_wps = COALESCE(@officeDiff, open_office_diff_in_wps),
        system_notifications_enabled = COALESCE(@notifications, system_notifications_enabled),
        knowledge_index_speed = COALESCE(@speed, knowledge_index_speed),
        language = COALESCE(@language, language),
        theme = COALESCE(@theme, theme)
      WHERE id = @id
    `
      )
      .run({
        id: SETTINGS_ROW_ID,
        officeDiff:
          patch.openOfficeDiffInWps === undefined ? null : Number(patch.openOfficeDiffInWps),
        notifications:
          patch.systemNotificationsEnabled === undefined
            ? null
            : patch.systemNotificationsEnabled
              ? 1
              : 0,
        speed: patch.knowledgeIndexSpeed ?? null,
        language: patch.language ?? null,
        theme: patch.theme ?? null
      })
    return this.get()
  }
}
