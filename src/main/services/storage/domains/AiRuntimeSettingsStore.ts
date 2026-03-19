import type { AiRuntimeSettings } from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type AiRuntimeSettingsRow = {
  id: string
  watchdog_mode: string
  updated_at: number
}

const DEFAULT_SETTINGS: AiRuntimeSettings = {
  watchdogMode: 'auto'
}

export class AiRuntimeSettingsStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async get(): Promise<AiRuntimeSettings> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUNTIME_SETTINGS)
    const rows = (await table.query().limit(1).toArray()) as AiRuntimeSettingsRow[]
    const row = rows[0]
    if (!row) return DEFAULT_SETTINGS

    return {
      watchdogMode:
        row.watchdog_mode === 'off' ||
        row.watchdog_mode === 'auto' ||
        row.watchdog_mode === 'aggressive'
          ? row.watchdog_mode
          : DEFAULT_SETTINGS.watchdogMode
    }
  }

  public async save(settings: AiRuntimeSettings): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUNTIME_SETTINGS)
    await table.delete("id = 'default'")
    await table.add([
      {
        id: 'default',
        watchdog_mode: settings.watchdogMode,
        updated_at: Date.now()
      }
    ])
  }
}
