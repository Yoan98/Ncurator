import type { LLMConfig } from '../../../types/store'
import { resolveLlmProviderKind } from '../../../../shared/llmProvider'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { insertOrReplace } from '../sqlite/sqliteUtils'

type LlmConfigRow = {
  id?: unknown
  providerKind?: unknown
  base_url?: unknown
  api_key?: unknown
  is_active?: unknown
  default_model?: unknown
}

const toConfig = (row: LlmConfigRow): LLMConfig => ({
  id: String(row.id || ''),
  providerKind: resolveLlmProviderKind({
    providerKind: String(row.providerKind || ''),
    baseUrl: String(row.base_url || '')
  }),
  base_url: String(row.base_url || ''),
  api_key: String(row.api_key || ''),
  is_active: row.is_active === 1 || row.is_active === true,
  default_model: String(row.default_model || '')
})

export class LlmConfigStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async save(config: LLMConfig): Promise<void> {
    insertOrReplace(this.sqlite, 'llm_config', {
      id: config.id,
      providerKind: config.providerKind,
      base_url: config.base_url,
      api_key: config.api_key,
      is_active: config.is_active ? 1 : 0,
      default_model: config.default_model
    })
  }

  public async list(): Promise<LLMConfig[]> {
    const rows = this.sqlite.prepare('SELECT * FROM llm_config').all() as LlmConfigRow[]
    return rows.map(toConfig)
  }

  public async delete(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM llm_config WHERE id = ?').run(id)
  }

  public async setActive(id: string): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE llm_config SET is_active = 0 WHERE is_active = 1').run()
      this.sqlite.prepare('UPDATE llm_config SET is_active = 1 WHERE id = ?').run(id)
    })
  }

  public async getActive(): Promise<LLMConfig | null> {
    const row = this.sqlite
      .prepare('SELECT * FROM llm_config WHERE is_active = 1 LIMIT 1')
      .get() as LlmConfigRow | undefined
    return row ? toConfig(row) : null
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
