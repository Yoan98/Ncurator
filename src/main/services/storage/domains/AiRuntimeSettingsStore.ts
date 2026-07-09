import type { AiRuntimeSettings } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  llmStreamingMode: 'force_stream'
}

type AiRuntimeSettingsRow = {
  id?: unknown
  llmStreamingMode?: unknown
  updated_at?: unknown
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
        row.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream'
    }
  }

  public async save(settings: AiRuntimeSettings): Promise<void> {
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO ai_runtime_settings (id, llmStreamingMode, updated_at)
        VALUES (@id, @llmStreamingMode, @updated_at)
      `
      )
      .run({
        id: SETTINGS_ROW_ID,
        llmStreamingMode:
          settings.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream',
        updated_at: Date.now()
      })
  }
}
