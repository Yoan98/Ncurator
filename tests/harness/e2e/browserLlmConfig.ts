import type { LlmRuntimeConfig } from '../../../src/shared/types'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import { resolveLlmProviderKind } from '../../../src/shared/llmProvider'
import { loadRootEnvOnce } from '../core/rootEnv'

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

const resolveBrowserE2EModelName = (): string => readEnv('AI_LIVE_PRIMARY_MODEL_NAME')

const resolveBrowserE2EBaseUrl = (): string => {
  return normalizeOpenAIBaseUrl(readEnv('AI_LIVE_BASE_URL'))
}

export const hasBrowserE2ELlmConfigInEnv = (): boolean => {
  const apiKey = readEnv('AI_LIVE_API_KEY')
  return Boolean(resolveBrowserE2EBaseUrl() && resolveBrowserE2EModelName() && apiKey)
}

export const loadBrowserE2ELlmConfigFromEnv = (): LlmRuntimeConfig => {
  const baseUrl = resolveBrowserE2EBaseUrl()
  const modelName = resolveBrowserE2EModelName()
  const apiKey = readEnv('AI_LIVE_API_KEY')

  if (!baseUrl || !modelName || !apiKey) {
    throw new Error(
      [
        'browser e2e 缺少网页操作模型配置，请设置环境变量：',
        '- AI_LIVE_BASE_URL',
        '- AI_LIVE_API_KEY',
        '- AI_LIVE_PRIMARY_MODEL_NAME',
        '可选配置：',
        '- AI_LIVE_PROVIDER_KIND（默认按 base URL 推断）'
      ].join('\n')
    )
  }

  return {
    id: 'browser-e2e-config',
    providerKind: resolveLlmProviderKind({
      providerKind: readEnv('AI_LIVE_PROVIDER_KIND'),
      baseUrl
    }),
    base_url: baseUrl,
    api_key: apiKey,
    is_active: true,
    default_model: modelName,
    model_name: modelName
  }
}
