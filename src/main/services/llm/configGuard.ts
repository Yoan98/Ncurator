import type { LLMConfig } from '../../../shared/types'
import type { LlmConfigStore } from '../storage/domains/LlmConfigStore'
import { getProviderRegistryEntry, resolvePresetModeProvider } from '../../../shared/llmPresets'

export type LlmConfigSaveCheck =
  | { ok: true; config: LLMConfig }
  | { ok: false; error: string }

export const validateLlmConfigForSave = async (
  llmStore: LlmConfigStore,
  config: LLMConfig
): Promise<LlmConfigSaveCheck> => {
  const preset = resolvePresetModeProvider(config)
  if (preset) {
    const registryEntry = getProviderRegistryEntry(preset.providerId)
    if (!registryEntry) {
      return { ok: false, error: '服务商配置不完整' }
    }
    const existing = await llmStore.list()
    const duplicated = existing.some(
      (item) =>
        item.id !== config.id && resolvePresetModeProvider(item)?.providerId === preset.providerId
    )
    if (duplicated) {
      return { ok: false, error: `已存在 ${preset.label} 配置，同一服务商只允许一条预设配置` }
    }
    return {
      ok: true,
      config: {
        ...config,
        name: preset.label,
        base_url: registryEntry.defaultBaseUrl,
        providerKind: registryEntry.providerKind
      }
    }
  }

  const name = config.name.trim()
  if (!name) {
    return { ok: false, error: '请输入配置名称' }
  }
  const existing = await llmStore.list()
  const duplicated = existing.some((item) => item.id !== config.id && item.name.trim() === name)
  if (duplicated) {
    return { ok: false, error: '配置名称不能重复' }
  }
  return { ok: true, config }
}