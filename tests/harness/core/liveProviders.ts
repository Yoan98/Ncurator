import {
  getPresetProviderLabel,
  getProviderRegistryEntry,
  type LlmPresetProviderId
} from '../../../src/shared/llmPresets'
import { normalizeOpenAIBaseUrl } from '../../../src/shared/llmBaseUrl'
import type { LlmProviderKind } from '../../../src/shared/types'
import { loadRootEnvOnce } from './rootEnv'

/** Built-in providers that live tests may configure via Key-only env. */
export const LIVE_PRESET_PROVIDER_IDS = [
  'deepseek',
  'dashscope',
  'mimo',
  'zhipu'
] as const satisfies readonly LlmPresetProviderId[]

export type LivePresetProviderId = (typeof LIVE_PRESET_PROVIDER_IDS)[number]

/** Per-provider default model for smoke / fallback when AI_LIVE_MODEL is unset. */
export const LIVE_PROVIDER_DEFAULT_MODEL: Record<LivePresetProviderId, string> = {
  dashscope: 'qwen3.8-flash',
  deepseek: 'deepseek-flash',
  mimo: 'mimo-v2.6-flash',
  zhipu: 'glm-5.3-flash'
}

export const LIVE_DEFAULT_PROVIDER: LivePresetProviderId = 'dashscope'

export type LiveLlmTarget = {
  providerId: LivePresetProviderId | 'custom'
  label: string
  baseUrl: string
  providerKind: LlmProviderKind
  apiKey: string
  modelName: string
}

type LivePresetLlmTarget = LiveLlmTarget & { providerId: LivePresetProviderId }

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

export const liveKeyEnvName = (providerId: LivePresetProviderId): string =>
  `AI_LIVE_KEY_${providerId.toUpperCase()}`

export const isLivePresetProviderId = (value: string): value is LivePresetProviderId =>
  LIVE_PRESET_PROVIDER_IDS.includes(value as LivePresetProviderId)

const resolveProviderId = (raw: string): LiveLlmTarget['providerId'] => {
  const value = raw.trim()
  if (!value) return LIVE_DEFAULT_PROVIDER
  if (value !== 'custom' && !isLivePresetProviderId(value)) {
    throw new Error(
      `AI_LIVE_PROVIDER 必须是 ${[...LIVE_PRESET_PROVIDER_IDS, 'custom'].join(', ')} 之一（当前：${value}）`
    )
  }
  return value
}

const buildTarget = (providerId: LivePresetProviderId, modelName: string): LivePresetLlmTarget => {
  const apiKey = readEnv(liveKeyEnvName(providerId))
  if (!apiKey) {
    throw new Error(`缺少 ${liveKeyEnvName(providerId)}，无法解析 live 服务商 ${providerId}`)
  }
  const registry = getProviderRegistryEntry(providerId)
  if (!registry) {
    throw new Error(`内置服务商 ${providerId} 不在 LLM_PROVIDER_REGISTRY`)
  }
  const resolvedModel = modelName.trim() || LIVE_PROVIDER_DEFAULT_MODEL[providerId]
  if (!resolvedModel) {
    throw new Error(`服务商 ${providerId} 未配置默认测试模型`)
  }
  return {
    providerId,
    label: getPresetProviderLabel(providerId) || registry.label,
    baseUrl: registry.defaultBaseUrl,
    providerKind: registry.providerKind,
    apiKey,
    modelName: resolvedModel
  }
}

const requireCustomEnv = (name: string): string => {
  const value = readEnv(name)
  if (!value) throw new Error(`缺少 ${name}，无法解析自定义 live 配置`)
  return value
}

const buildCustomTarget = (): LiveLlmTarget => {
  const baseUrl = normalizeOpenAIBaseUrl(requireCustomEnv('AI_LIVE_BASE_URL'))
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
  } catch {
    throw new Error('AI_LIVE_BASE_URL 必须是有效的 HTTP 或 HTTPS 地址')
  }
  return {
    providerId: 'custom',
    label: '自定义测试服务',
    baseUrl,
    providerKind: 'openai-compatible',
    apiKey: requireCustomEnv('AI_LIVE_API_KEY'),
    modelName: requireCustomEnv('AI_LIVE_MODEL')
  }
}

/** Primary live target for everyday human / workbench AI cases. */
export const resolveLiveLlmTarget = (): LiveLlmTarget => {
  const providerId = resolveProviderId(readEnv('AI_LIVE_PROVIDER'))
  if (providerId === 'custom') return buildCustomTarget()
  const modelOverride = readEnv('AI_LIVE_MODEL')
  return buildTarget(providerId, modelOverride || LIVE_PROVIDER_DEFAULT_MODEL[providerId])
}

/** Providers with a Key present — used by the all-provider smoke case. */
export const listConfiguredLiveLlmTargets = (): LivePresetLlmTarget[] => {
  const targets: LivePresetLlmTarget[] = []
  for (const providerId of LIVE_PRESET_PROVIDER_IDS) {
    if (!readEnv(liveKeyEnvName(providerId))) continue
    targets.push(buildTarget(providerId, LIVE_PROVIDER_DEFAULT_MODEL[providerId]))
  }
  return targets
}
