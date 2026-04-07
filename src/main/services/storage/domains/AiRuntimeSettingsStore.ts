import type { AiRuntimeSettings } from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

const SETTINGS_ROW_ID = 'singleton'

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  llmStreamingMode: 'force_stream'
}

type AiRuntimeSettingsRow = {
  id?: string | null
  llmStreamingMode?: string | null
  updated_at?: number | bigint | null
}

export class AiRuntimeSettingsStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async get(): Promise<AiRuntimeSettings> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUNTIME_SETTINGS)
    const rows = await table
      .query()
      .where(`id = '${this.core.escapeSqlString(SETTINGS_ROW_ID)}'`)
      .toArray()
    const row = (rows?.[0] || null) as AiRuntimeSettingsRow | null
    if (!row) return DEFAULT_SETTINGS

    return {
      llmStreamingMode:
        row.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream'
    }
  }

  public async save(settings: AiRuntimeSettings): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUNTIME_SETTINGS)
    await table.delete(`id = '${this.core.escapeSqlString(SETTINGS_ROW_ID)}'`)
    await table.add([
      {
        id: SETTINGS_ROW_ID,
        llmStreamingMode:
          settings.llmStreamingMode === 'force_non_stream' ? 'force_non_stream' : 'force_stream',
        updated_at: Date.now()
      }
    ])
  }
}
