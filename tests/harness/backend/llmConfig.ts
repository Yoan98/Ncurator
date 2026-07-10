import type { LiveLlmConfig } from './test-types'
import { loadRootEnvOnce } from '../core/rootEnv'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import { resolveLlmProviderKind } from '../../../src/shared/llmProvider'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_PRIMARY_MODEL_NAME = 'gpt-5'

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

const canDefaultToOpenAiBaseUrl = (modelName: string): boolean => {
  const normalized = modelName.trim().toLowerCase()
  return (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  )
}

const resolveLiveModelName = (): string =>
  readEnv('AI_LIVE_PRIMARY_MODEL_NAME') || DEFAULT_PRIMARY_MODEL_NAME

const resolveLiveBaseUrl = (modelName: string): string => {
  const rawBaseUrl =
    readEnv('AI_LIVE_BASE_URL') ||
    (canDefaultToOpenAiBaseUrl(modelName) ? DEFAULT_OPENAI_BASE_URL : '')
  return normalizeOpenAIBaseUrl(rawBaseUrl)
}

export const hasLiveLlmConfigInEnv = (): boolean => {
  const modelName = resolveLiveModelName()
  const baseUrl = resolveLiveBaseUrl(modelName)
  const apiKey = readEnv('AI_LIVE_API_KEY')
  return Boolean(baseUrl && modelName && apiKey)
}

export const loadLiveLlmConfigFromEnv = (): LiveLlmConfig => {
  const modelName = resolveLiveModelName()
  const baseUrl = resolveLiveBaseUrl(modelName)
  const apiKey = readEnv('AI_LIVE_API_KEY')

  if (!baseUrl || !modelName || !apiKey) {
    throw new Error(
      [
        'human 缺少 live 模型配置，请至少设置环境变量：',
        '- AI_LIVE_API_KEY',
        '可选配置：',
        '- AI_LIVE_BASE_URL（OpenAI 系列为空时默认 https://api.openai.com/v1）',
        '- AI_LIVE_PRIMARY_MODEL_NAME（默认 gpt-5）'
      ].join('\n')
    )
  }

  return {
    id: 'ai-live-config',
    name: 'AI Live',
    providerKind: resolveLlmProviderKind({
      providerKind: readEnv('AI_LIVE_PROVIDER_KIND'),
      baseUrl
    }),
    base_url: baseUrl,
    model_name: modelName,
    api_key: apiKey
  }
}
