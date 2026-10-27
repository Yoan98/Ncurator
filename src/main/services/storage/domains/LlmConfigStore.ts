import type { LLMConfig } from '../../../types/store'
import { isLlmProviderKind } from '../../../../shared/llmProvider'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { parseStringArray } from '../sqlite/sqliteUtils'

type LlmConfigRow = {
  id?: unknown
  name?: unknown
  providerKind?: unknown
  base_url?: unknown
  api_key?: unknown
  manual_models_json?: unknown
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
    api_key: String(row.api_key || ''),
    manualModels: parseStringArray(row.manual_models_json) || []
  }
}

export class LlmConfigStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async save(config: LLMConfig): Promise<void> {
    this.sqlite
      .prepare(
        `
      INSERT INTO llm_config (id, name, providerKind, base_url, api_key)
      VALUES (@id, @name, @providerKind, @base_url, @api_key)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name,
        providerKind = excluded.providerKind, base_url = excluded.base_url, api_key = excluded.api_key
    `
      )
      .run({
        id: config.id,
        name: config.name,
        providerKind: config.providerKind,
        base_url: config.base_url,
        api_key: config.api_key
      })
  }

  public async addManualModel(configId: string, modelName: string): Promise<LLMConfig> {
    const name = modelName.trim()
    if (!name) throw new Error('请输入模型名称')
    const row = this.sqlite.prepare('SELECT * FROM llm_config WHERE id = ?').get(configId) as
      | LlmConfigRow
      | undefined
    if (!row) throw new Error('配置不存在')
    const config = toConfig(row)
    const manualModels = [...new Set([...(config.manualModels || []), name])]
    this.sqlite
      .prepare('UPDATE llm_config SET manual_models_json = ? WHERE id = ?')
      .run(JSON.stringify(manualModels), configId)
    return { ...config, manualModels }
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
