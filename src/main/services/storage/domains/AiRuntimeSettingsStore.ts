import type { AiRuntimeSettings } from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

const DEFAULT_SETTINGS: AiRuntimeSettings = {}

export class AiRuntimeSettingsStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async get(): Promise<AiRuntimeSettings> {
    void this.core
    return DEFAULT_SETTINGS
  }

  public async save(_settings: AiRuntimeSettings): Promise<void> {
    void LANCE_TABLES.AI_RUNTIME_SETTINGS
  }
}
