import type { LiveLlmConfig } from './test-types'
import { loadRootEnvOnce } from '../core/rootEnv'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import { inferLlmProviderKind, resolveLlmProviderKind } from '../../../src/shared/llmProvider'

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

const missingLiveEnvError = (names: readonly string[]): Error =>
  new Error(`human 缺少 live 模型配置：${names.map((name) => `AI_LIVE_${name}`).join(', ')}`)

export const loadLiveLlmConfigFromEnv = (): LiveLlmConfig => {
  const modelName = readEnv('AI_LIVE_PRIMARY_MODEL_NAME')
  const baseUrl = normalizeOpenAIBaseUrl(readEnv('AI_LIVE_BASE_URL'))
  const apiKey = readEnv('AI_LIVE_API_KEY')

  if (!baseUrl || !modelName || !apiKey) {
    throw missingLiveEnvError(['BASE_URL', 'API_KEY', 'PRIMARY_MODEL_NAME'])
  }

  return {
    id: 'ai-live-config',
    name: 'AI Live',
    providerKind: resolveLlmProviderKind({
      providerKind: readEnv('AI_LIVE_PROVIDER_KIND') || inferLlmProviderKind(baseUrl),
      baseUrl
    }),
    base_url: baseUrl,
    model_name: modelName,
    api_key: apiKey
  }
}

export const loadLiveVisionLlmConfigFromEnv = (): LiveLlmConfig => {
  const baseUrl = normalizeOpenAIBaseUrl(readEnv('AI_LIVE_VISION_BASE_URL'))
  const apiKey = readEnv('AI_LIVE_VISION_API_KEY')
  const modelName = readEnv('AI_LIVE_VISUAL_MODEL_NAME')
  if (!baseUrl || !apiKey || !modelName) {
    throw missingLiveEnvError(['VISION_BASE_URL', 'VISION_API_KEY', 'VISUAL_MODEL_NAME'])
  }
  return {
    id: 'ai-live-vision-config',
    name: 'AI Live Vision',
    providerKind: resolveLlmProviderKind({
      providerKind: readEnv('AI_LIVE_VISION_PROVIDER_KIND') || inferLlmProviderKind(baseUrl),
      baseUrl
    }),
    base_url: baseUrl,
    model_name: modelName,
    api_key: apiKey
  }
}
