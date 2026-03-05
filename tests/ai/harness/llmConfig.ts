import type { LiveLlmConfig } from './types'

const readEnv = (name: string): string => String(process.env[name] || '').trim()

export const isLiveSuiteEnabled = (): boolean => {
  return readEnv('AI_LIVE_ENABLE') === '1'
}

export const loadLiveLlmConfigFromEnv = (): LiveLlmConfig => {
  const baseUrl = readEnv('AI_LIVE_BASE_URL')
  const modelName = readEnv('AI_LIVE_MODEL_NAME')
  const apiKey = readEnv('AI_LIVE_API_KEY')

  if (!baseUrl || !modelName || !apiKey) {
    throw new Error(
      [
        'human-live 缺少模型配置，请设置环境变量：',
        '- AI_LIVE_BASE_URL',
        '- AI_LIVE_MODEL_NAME',
        '- AI_LIVE_API_KEY'
      ].join('\n')
    )
  }

  return {
    id: 'ai-live-config',
    name: 'AI Live Config',
    base_url: baseUrl,
    model_name: modelName,
    api_key: apiKey,
    is_active: true
  }
}
