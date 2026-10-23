import {
  LOCAL_EMBEDDING_MODEL_ID,
  type EmbeddingModelSettings
} from '../../../../shared/embeddingModels'
import type { SqliteCore } from '../sqlite/SqliteCore'

const SETTINGS_ROW_ID = 'singleton'

export class EmbeddingSettingsStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public get(): EmbeddingModelSettings {
    const row = this.sqlite
      .prepare<
        [string],
        { settings_json: string }
      >('SELECT settings_json FROM embedding_settings WHERE id = ?')
      .get(SETTINGS_ROW_ID)
    if (!row) return { activeModelId: LOCAL_EMBEDDING_MODEL_ID, remoteModels: [] }
    return JSON.parse(row.settings_json) as EmbeddingModelSettings
  }

  public save(settings: EmbeddingModelSettings): void {
    this.sqlite
      .prepare(
        `INSERT INTO embedding_settings (id, settings_json) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`
      )
      .run(SETTINGS_ROW_ID, JSON.stringify(settings))
  }
}
