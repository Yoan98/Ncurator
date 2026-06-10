import type { LlmRuntimeConfig } from '../../../src/shared/types'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import { resolveLlmProviderKind } from '../../../src/shared/llmProvider'
import { loadRootEnvOnce } from '../core/rootEnv'

const DEFAULT_BROWSER_E2E_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_BROWSER_E2E_MODEL_NAME = 'qwen3-vl-plus'

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

const resolveBrowserE2EModelName = (): string =>
  readEnv('AI_BROWSER_E2E_MODEL_NAME') || DEFAULT_BROWSER_E2E_MODEL_NAME

const resolveBrowserE2EBaseUrl = (): string => {
  const browserBaseUrl = readEnv('AI_BROWSER_E2E_BASE_URL')
  if (browserBaseUrl) return normalizeOpenAIBaseUrl(browserBaseUrl)
  if (!readEnv('AI_BROWSER_E2E_API_KEY')) {
    const liveBaseUrl = readEnv('AI_LIVE_BASE_URL')
    if (liveBaseUrl) return normalizeOpenAIBaseUrl(liveBaseUrl)
  }
  return normalizeOpenAIBaseUrl(DEFAULT_BROWSER_E2E_BASE_URL)
}

export const hasBrowserE2ELlmConfigInEnv = (): boolean => {
  const apiKey = readEnv('AI_BROWSER_E2E_API_KEY') || readEnv('AI_LIVE_API_KEY')
  return Boolean(resolveBrowserE2EBaseUrl() && resolveBrowserE2EModelName() && apiKey)
}

export const loadBrowserE2ELlmConfigFromEnv = (): LlmRuntimeConfig => {
  const baseUrl = resolveBrowserE2EBaseUrl()
  const modelName = resolveBrowserE2EModelName()
  const apiKey = readEnv('AI_BROWSER_E2E_API_KEY') || readEnv('AI_LIVE_API_KEY')

  if (!baseUrl || !modelName || !apiKey) {
    throw new Error(
      [
        'browser e2e 缺少视觉/网页操作模型配置，请设置环境变量：',
        '- AI_BROWSER_E2E_API_KEY',
        '可选配置：',
        `- AI_BROWSER_E2E_BASE_URL（未设置专用 key 时可复用 AI_LIVE_BASE_URL，否则默认 ${DEFAULT_BROWSER_E2E_BASE_URL}）`,
        `- AI_BROWSER_E2E_MODEL_NAME（默认 ${DEFAULT_BROWSER_E2E_MODEL_NAME}）`,
        '- AI_BROWSER_E2E_PROVIDER_KIND（默认按 base URL 推断）',
        '兼容：未设置 AI_BROWSER_E2E_API_KEY 时会复用 AI_LIVE_API_KEY。'
      ].join('\n')
    )
  }

  return {
    id: 'browser-e2e-config',
    providerKind: resolveLlmProviderKind({
      providerKind: readEnv('AI_BROWSER_E2E_PROVIDER_KIND'),
      baseUrl
    }),
    base_url: baseUrl,
    api_key: apiKey,
    is_active: true,
    default_model: modelName,
    model_name: modelName
  }
}
