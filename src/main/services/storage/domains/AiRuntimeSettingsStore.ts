import type { AiRuntimeSettings } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  llmStreamingMode: 'force_stream',
  systemNotificationsEnabled: true
}

type AiRuntimeSettingsRow = {
  id?: string
  llmStreamingMode?: string
  systemNotificationsEnabled?: number
  updated_at?: number
}

export class AiRuntimeSettingsStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async get(): Promise<AiRuntimeSettings> {
    const row = this.sqlite
      .prepare('SELECT * FROM ai_runtime_settings WHERE id = ?')
      .get(SETTINGS_ROW_ID) as AiRuntimeSettingsRow | undefined
    if (!row) return DEFAULT_SETTINGS
    return {
      llmStreamingMode:
        row.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream',
      systemNotificationsEnabled: row.systemNotificationsEnabled !== 0
    }
  }

  public async save(settings: AiRuntimeSettings): Promise<AiRuntimeSettings> {
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO ai_runtime_settings (id, llmStreamingMode, systemNotificationsEnabled, updated_at)
        VALUES (@id, @llmStreamingMode, @systemNotificationsEnabled, @updated_at)
      `
      )
      .run({
        id: SETTINGS_ROW_ID,
        llmStreamingMode:
          settings.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream',
        systemNotificationsEnabled: settings.systemNotificationsEnabled === false ? 0 : 1,
        updated_at: Date.now()
      })
    return await this.get()
  }
}
