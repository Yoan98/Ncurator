import type {
  AiStructuredOutputTransport,
  StructuredOutputMode,
  StructuredOutputStrategy
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'

export type LlmStrategyPreference = {
  configId: string
  modelName: string
  preferredTransport: AiStructuredOutputTransport
  preferredStructuredOutputMode: StructuredOutputMode
  updatedAt: number
}

type LlmStrategyPreferenceRow = {
  config_id?: unknown
  model_name?: unknown
  preferred_transport?: unknown
  preferred_structured_output_mode?: unknown
  updated_at?: unknown
}

const isTransport = (value: string): value is AiStructuredOutputTransport =>
  value === 'completions' || value === 'responses'

const isStructuredOutputMode = (value: string): value is StructuredOutputMode =>
  value === 'json_schema' || value === 'json_object' || value === 'prompt_json'

const normalizeKey = (value: string): string => String(value || '').trim()

const toPreference = (row: LlmStrategyPreferenceRow): LlmStrategyPreference | null => {
  const configId = normalizeKey(String(row.config_id || ''))
  const modelName = normalizeKey(String(row.model_name || ''))
  const preferredTransport = normalizeKey(String(row.preferred_transport || ''))
  const preferredStructuredOutputMode = normalizeKey(
    String(row.preferred_structured_output_mode || '')
  )
  const updatedAt = Number(row.updated_at || 0)
  if (
    !configId ||
    !modelName ||
    !isTransport(preferredTransport) ||
    !isStructuredOutputMode(preferredStructuredOutputMode) ||
    !Number.isFinite(updatedAt)
  ) {
    return null
  }
  return {
    configId,
    modelName,
    preferredTransport,
    preferredStructuredOutputMode,
    updatedAt
  }
}

export class LlmStrategyPreferenceStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async get(input: {
    configId: string
    modelName: string
  }): Promise<LlmStrategyPreference | null> {
    const configId = normalizeKey(input.configId)
    const modelName = normalizeKey(input.modelName)
    if (!configId || !modelName) return null
    const row = this.sqlite
      .prepare(
        `
        SELECT *
        FROM llm_strategy_preference
        WHERE config_id = ? AND model_name = ?
      `
      )
      .get(configId, modelName) as LlmStrategyPreferenceRow | undefined
    return row ? toPreference(row) : null
  }

  public async save(input: {
    configId: string
    modelName: string
    strategy: StructuredOutputStrategy
  }): Promise<void> {
    const configId = normalizeKey(input.configId)
    const modelName = normalizeKey(input.modelName)
    if (!configId || !modelName) return
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO llm_strategy_preference (
          config_id,
          model_name,
          preferred_transport,
          preferred_structured_output_mode,
          updated_at
        ) VALUES (
          @config_id,
          @model_name,
          @preferred_transport,
          @preferred_structured_output_mode,
          @updated_at
        )
      `
      )
      .run({
        config_id: configId,
        model_name: modelName,
        preferred_transport: input.strategy.transport,
        preferred_structured_output_mode: input.strategy.mode,
        updated_at: Date.now()
      })
  }
}
