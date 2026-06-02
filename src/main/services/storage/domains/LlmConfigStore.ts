import type { LLMConfig } from '../../../types/store'
import { resolveLlmProviderKind } from '../../../../shared/llmProvider'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type LlmConfigRow = {
  id?: string | null
  providerKind?: string | null
  base_url?: string | null
  api_key?: string | null
  is_active?: boolean | null
  default_model?: string | null
}

export class LlmConfigStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async save(config: LLMConfig): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.LLM_CONFIG)
    await table.delete(`id = '${this.core.escapeSqlString(config.id)}'`)
    await table.add([{ ...config }])
  }

  public async list(): Promise<LLMConfig[]> {
    const table = await this.core.openTable(LANCE_TABLES.LLM_CONFIG)
    const results = await table.query().toArray()
    return results.map((r) => {
      const row = r as LlmConfigRow
      return {
        id: String(row.id || ''),
        providerKind: resolveLlmProviderKind({
          providerKind: String(row.providerKind || ''),
          baseUrl: String(row.base_url || '')
        }),
        base_url: String(row.base_url || ''),
        api_key: String(row.api_key || ''),
        is_active: Boolean(row.is_active),
        default_model: String(row.default_model || '')
      }
    })
  }

  public async delete(id: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.LLM_CONFIG)
    await table.delete(`id = '${this.core.escapeSqlString(id)}'`)
  }

  public async setActive(id: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.LLM_CONFIG)
    await table.update({ where: 'is_active = true', values: { is_active: false } })
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: { is_active: true }
    })
  }

  public async getActive(): Promise<LLMConfig | null> {
    const configs = await this.list()
    return configs.find((c) => c.is_active) || null
  }

  public async getById(id: string): Promise<LLMConfig | null> {
    const safeId = String(id || '').trim()
    if (!safeId) return null
    const configs = await this.list()
    return configs.find((config) => config.id === safeId) || null
  }
}
