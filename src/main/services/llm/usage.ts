import type { AiLlmUsage, JsonObject, JsonValue, LlmProviderKind } from '../../../shared/types'

type MetadataMessage = {
  response_metadata?: unknown
  usage_metadata?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toJsonObject = (value: unknown): JsonObject | undefined => {
  if (!isRecord(value)) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject
  } catch {
    return undefined
  }
}

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const getPath = (value: unknown, path: string[]): unknown => {
  let current = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

const firstNumber = (value: unknown, paths: string[][]): number | undefined => {
  for (const path of paths) {
    const numberValue = readNumber(getPath(value, path))
    if (numberValue !== undefined) return numberValue
  }
  return undefined
}

const extractUsagePayload = (
  responseMetadata: unknown
): { source: 'response_metadata'; payload: unknown } | undefined => {
  const usage = getPath(responseMetadata, ['usage'])
  if (isRecord(usage)) return { source: 'response_metadata', payload: usage }
  const tokenUsage = getPath(responseMetadata, ['tokenUsage'])
  if (isRecord(tokenUsage)) return { source: 'response_metadata', payload: tokenUsage }
  return undefined
}

const toCacheHitRate = (input: {
  inputTokens?: number
  cachedInputTokens?: number
}): number | undefined => {
  if (
    input.inputTokens === undefined ||
    input.cachedInputTokens === undefined ||
    input.inputTokens <= 0
  ) {
    return undefined
  }
  return input.cachedInputTokens / input.inputTokens
}

const normalizeFromPayload = (input: {
  source: AiLlmUsage['source']
  payload: unknown
  providerKind?: LlmProviderKind
}): AiLlmUsage => {
  const inputTokens = firstNumber(input.payload, [
    ['input_tokens'],
    ['prompt_tokens'],
    ['promptTokens']
  ])
  const outputTokens = firstNumber(input.payload, [
    ['output_tokens'],
    ['completion_tokens'],
    ['completionTokens']
  ])
  const totalTokens = firstNumber(input.payload, [
    ['total_tokens'],
    ['totalTokens']
  ])
  const cachedInputTokens = firstNumber(input.payload, [
    ['input_token_details', 'cache_read'],
    ['input_token_details', 'cached_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['prompt_cache_hit_tokens']
  ])
  const cacheMissInputTokens = firstNumber(input.payload, [
    ['prompt_cache_miss_tokens'],
    ['input_token_details', 'cache_miss']
  ])
  const cacheWriteInputTokens = firstNumber(input.payload, [
    ['input_token_details', 'cache_creation'],
    ['cache_creation_input_tokens']
  ])
  const rawUsage = toJsonObject(input.payload)
  const hasCacheSignal =
    cachedInputTokens !== undefined ||
    cacheMissInputTokens !== undefined ||
    cacheWriteInputTokens !== undefined
  const hasTokenSignal =
    inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheMissInputTokens,
    cacheWriteInputTokens,
    cacheHitRate: toCacheHitRate({ inputTokens, cachedInputTokens }),
    source: hasTokenSignal || hasCacheSignal ? input.source : 'unavailable',
    rawUsage
  }
}

export const normalizeLlmUsage = (input: {
  message?: MetadataMessage
  providerKind?: LlmProviderKind
}): AiLlmUsage => {
  const usageMetadata = input.message?.usage_metadata
  const usageFromMetadata = normalizeFromPayload({
    source: 'usage_metadata',
    payload: usageMetadata,
    providerKind: input.providerKind
  })
  const metadataHasCache =
    usageFromMetadata.cachedInputTokens !== undefined ||
    usageFromMetadata.cacheMissInputTokens !== undefined ||
    usageFromMetadata.cacheWriteInputTokens !== undefined
  if (usageFromMetadata.source !== 'unavailable' && metadataHasCache) return usageFromMetadata

  const responseUsage = extractUsagePayload(input.message?.response_metadata)
  if (responseUsage) {
    const usageFromResponse = normalizeFromPayload({
      source: responseUsage.source,
      payload: responseUsage.payload,
      providerKind: input.providerKind
    })
    if (usageFromResponse.source !== 'unavailable') {
      return {
        ...usageFromResponse,
        inputTokens: usageFromResponse.inputTokens ?? usageFromMetadata.inputTokens,
        outputTokens: usageFromResponse.outputTokens ?? usageFromMetadata.outputTokens,
        totalTokens: usageFromResponse.totalTokens ?? usageFromMetadata.totalTokens,
        cacheHitRate:
          usageFromResponse.cacheHitRate ??
          toCacheHitRate({
            inputTokens: usageFromResponse.inputTokens ?? usageFromMetadata.inputTokens,
            cachedInputTokens: usageFromResponse.cachedInputTokens
          })
      }
    }
  }

  if (usageFromMetadata.source !== 'unavailable') return usageFromMetadata
  return { source: 'unavailable' }
}

export const normalizeJsonObject = (value: unknown): JsonObject | undefined => toJsonObject(value)

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  isRecord(value)
