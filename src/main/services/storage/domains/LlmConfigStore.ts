import type { LLMConfig } from '../../../types/store'
import { isLlmProviderKind } from '../../../../shared/llmProvider'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { insertOrReplace } from '../sqlite/sqliteUtils'

type LlmConfigRow = {
  id?: unknown
  name?: unknown
  providerKind?: unknown
  base_url?: unknown
  api_key?: unknown
}

const toConfig = (row: LlmConfigRow): LLMConfig => {
  const providerKind = String(row.providerKind || '').trim()
  if (!isLlmProviderKind(providerKind)) {
    throw new Error(`llm_config_invalid_provider_kind:${String(row.id || '')}`)
  }
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    providerKind,
    base_url: String(row.base_url || ''),
    api_key: String(row.api_key || '')
  }
}

export class LlmConfigStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async save(config: LLMConfig): Promise<void> {
    insertOrReplace(this.sqlite, 'llm_config', {
      id: config.id,
      name: config.name,
      providerKind: config.providerKind,
      base_url: config.base_url,
      api_key: config.api_key
    })
  }

  public async list(): Promise<LLMConfig[]> {
    const rows = this.sqlite.prepare('SELECT * FROM llm_config').all() as LlmConfigRow[]
    return rows.map(toConfig)
  }

  public async delete(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM llm_config WHERE id = ?').run(id)
  }

  public async getById(id: string): Promise<LLMConfig | null> {
    const safeId = String(id || '').trim()
    if (!safeId) return null
    const row = this.sqlite.prepare('SELECT * FROM llm_config WHERE id = ?').get(safeId) as
      | LlmConfigRow
      | undefined
    return row ? toConfig(row) : null
  }
}
