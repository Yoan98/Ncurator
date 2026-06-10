import { normalizeOpenAIBaseUrl } from '../../../shared/llmBaseUrl'
import { resolveLlmProviderKind } from '../../../shared/llmProvider'
import type { LlmProviderKind, LlmRuntimeConfig } from '../../../shared/types'

export type OpenAICompatibleProviderKind = Extract<
  LlmProviderKind,
  'openai' | 'deepseek' | 'openai-compatible'
>

export type OpenAICompatibleRuntimeOptions = {
  providerKind: OpenAICompatibleProviderKind
  modelName: string
  baseURL: string
  apiKey: string
}

const OPENAI_COMPATIBLE_PROVIDER_KINDS: OpenAICompatibleProviderKind[] = [
  'openai',
  'deepseek',
  'openai-compatible'
]

const isOpenAICompatibleProviderKind = (
  value: string
): value is OpenAICompatibleProviderKind =>
  OPENAI_COMPATIBLE_PROVIDER_KINDS.includes(value as OpenAICompatibleProviderKind)

export const resolveOpenAICompatibleRuntimeOptions = (
  config: LlmRuntimeConfig,
  options?: {
    consumerName?: string
    supportedProviderKinds?: ReadonlyArray<OpenAICompatibleProviderKind>
  }
): OpenAICompatibleRuntimeOptions => {
  const consumerName = String(options?.consumerName || 'llm').trim() || 'llm'
  const supportedProviderKinds =
    options?.supportedProviderKinds && options.supportedProviderKinds.length > 0
      ? [...options.supportedProviderKinds]
      : OPENAI_COMPATIBLE_PROVIDER_KINDS

  const configuredProviderKind = String(config.providerKind || '').trim()
  if (configuredProviderKind && !isOpenAICompatibleProviderKind(configuredProviderKind)) {
    throw new Error(`${consumerName} only supports OpenAI-style providers: received ${configuredProviderKind}`)
  }

  const providerKind = configuredProviderKind
    ? configuredProviderKind
    : resolveLlmProviderKind({
        providerKind: config.providerKind,
        baseUrl: config.base_url
      })

  if (!isOpenAICompatibleProviderKind(providerKind)) {
    throw new Error(`${consumerName} only supports OpenAI-style providers: received ${providerKind}`)
  }
  if (!supportedProviderKinds.includes(providerKind)) {
    throw new Error(`${consumerName} does not support provider ${providerKind}`)
  }

  const modelName = String(config.model_name || '').trim()
  if (!modelName) {
    throw new Error(`${consumerName} requires a non-empty model_name`)
  }

  const baseURL = normalizeOpenAIBaseUrl(config.base_url)
  if (!baseURL) {
    throw new Error(`${consumerName} requires a non-empty base_url`)
  }

  const apiKey = String(config.api_key || '').trim()
  if (!apiKey) {
    throw new Error(`${consumerName} requires a non-empty api_key`)
  }

  return {
    providerKind,
    modelName,
    baseURL,
    apiKey
  }
}
