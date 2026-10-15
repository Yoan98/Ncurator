import {
  getPresetProviderLabel,
  getProviderRegistryEntry,
  isLlmPresetProviderId,
  type LlmPresetProviderId
} from '../../../src/shared/llmPresets'
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
  providerId: LivePresetProviderId
  label: string
  baseUrl: string
  providerKind: LlmProviderKind
  apiKey: string
  modelName: string
}

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

export const liveKeyEnvName = (providerId: LivePresetProviderId): string =>
  `AI_LIVE_KEY_${providerId.toUpperCase()}`

export const isLivePresetProviderId = (value: string): value is LivePresetProviderId =>
  LIVE_PRESET_PROVIDER_IDS.includes(value as LivePresetProviderId)

const resolveProviderId = (raw: string): LivePresetProviderId => {
  const value = raw.trim()
  if (!value) return LIVE_DEFAULT_PROVIDER
  if (!isLivePresetProviderId(value) || !isLlmPresetProviderId(value)) {
    throw new Error(
      `AI_LIVE_PROVIDER 必须是内置服务商之一：${LIVE_PRESET_PROVIDER_IDS.join(', ')}（当前：${value}）`
    )
  }
  return value
}

const buildTarget = (providerId: LivePresetProviderId, modelName: string): LiveLlmTarget => {
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

/** Primary live target for everyday human / workbench AI cases. */
export const resolveLiveLlmTarget = (): LiveLlmTarget => {
  const providerId = resolveProviderId(readEnv('AI_LIVE_PROVIDER'))
  const modelOverride = readEnv('AI_LIVE_MODEL')
  return buildTarget(providerId, modelOverride || LIVE_PROVIDER_DEFAULT_MODEL[providerId])
}

/** Providers with a Key present — used by the all-provider smoke case. */
export const listConfiguredLiveLlmTargets = (): LiveLlmTarget[] => {
  const targets: LiveLlmTarget[] = []
  for (const providerId of LIVE_PRESET_PROVIDER_IDS) {
    if (!readEnv(liveKeyEnvName(providerId))) continue
    targets.push(buildTarget(providerId, LIVE_PROVIDER_DEFAULT_MODEL[providerId]))
  }
  return targets
}
