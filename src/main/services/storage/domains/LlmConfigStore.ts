import type { LLMConfig } from '../../../types/store'
import { resolveLlmProviderKind } from '../../../../shared/llmProvider'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type LlmConfigRow = {
  id?: string | null
  name?: string | null
  providerKind?: string | null
  base_url?: string | null
  model_name?: string | null
  api_key?: string | null
  is_active?: boolean | null
  preferredStructuredOutputProfile?: string | null
  preferredTransport?: string | null
}

const isPreferredStructuredOutputProfile = (
  value: unknown
): value is NonNullable<LLMConfig['preferredStructuredOutputProfile']> =>
  value === 'completions:jsonSchema' ||
  value === 'completions:jsonMode' ||
  value === 'completions:promptJson' ||
  value === 'responses:jsonSchema' ||
  value === 'responses:promptJson'

const isPreferredTransport = (
  value: unknown
): value is NonNullable<LLMConfig['preferredTransport']> =>
  value === 'completions' || value === 'responses'

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
        name: String(row.name || ''),
        providerKind: resolveLlmProviderKind({
          providerKind: String(row.providerKind || ''),
          baseUrl: String(row.base_url || '')
        }),
        base_url: String(row.base_url || ''),
        model_name: String(row.model_name || ''),
        api_key: String(row.api_key || ''),
        is_active: Boolean(row.is_active),
        preferredStructuredOutputProfile: isPreferredStructuredOutputProfile(
          row.preferredStructuredOutputProfile
        )
          ? row.preferredStructuredOutputProfile
          : undefined,
        preferredTransport: isPreferredTransport(row.preferredTransport)
          ? row.preferredTransport
          : undefined
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
