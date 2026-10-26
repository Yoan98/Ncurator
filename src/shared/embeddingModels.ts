export const LOCAL_EMBEDDING_MODEL_ID = 'local:jinaai/jina-embeddings-v2-base-zh'

export const DEFAULT_EMBEDDING_INPUT_TOKENS = 512
export const MIN_EMBEDDING_INPUT_TOKENS = 32
export const MAX_EMBEDDING_INPUT_TOKENS = 1_048_576
export const EMBEDDING_INPUT_POLICY_VERSION = 'utf8-budget-v1'

export function defaultEmbeddingInputTokens(modelName: string): number {
  void modelName
  return DEFAULT_EMBEDDING_INPUT_TOKENS
}

export function embeddingInputBudget(maxInputTokens: number): {
  reservedTokens: number
  contentTokenBudget: number
} {
  if (
    !Number.isSafeInteger(maxInputTokens) ||
    maxInputTokens < MIN_EMBEDDING_INPUT_TOKENS ||
    maxInputTokens > MAX_EMBEDDING_INPUT_TOKENS
  ) {
    throw new Error(
      `最大输入长度必须为 ${MIN_EMBEDDING_INPUT_TOKENS}～${MAX_EMBEDDING_INPUT_TOKENS} 之间的整数 tokens。`
    )
  }
  const reservedTokens = Math.max(16, Math.ceil(maxInputTokens * 0.025))
  return { reservedTokens, contentTokenBudget: maxInputTokens - reservedTokens }
}

export type RemoteEmbeddingModel = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  modelName: string
  maxInputTokens?: number
}

export type EmbeddingModelSettings = {
  activeModelId: string
  remoteModels: RemoteEmbeddingModel[]
}

export type RemoteEmbeddingModelSummary = Omit<RemoteEmbeddingModel, 'apiKey'> & {
  hasApiKey: boolean
}

export type RemoteEmbeddingModelInput = Omit<RemoteEmbeddingModel, 'id' | 'apiKey'> & {
  id?: string
  apiKey?: string
}

export type EmbeddingIndexSnapshot = {
  staleFileCount: number
  staleWebCount: number
  running: boolean
  restoreModelId?: string
}

export type EmbeddingModelsSnapshot = {
  activeModelId: string
  remoteModels: RemoteEmbeddingModelSummary[]
  index: EmbeddingIndexSnapshot
}

export type EmbeddingModelMutationResponse = {
  success: boolean
  snapshot?: EmbeddingModelsSnapshot
  error?: string
}

export type EmbeddingModelTestResponse = {
  success: boolean
  dimension?: number
  error?: string
}
