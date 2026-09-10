import type { LLMConfig, LlmRemoteModel, WorkbenchSelectedModel } from './types'
import {
  getPresetModel,
  resolvePresetModeProvider,
  type LlmPresetModel,
  type LlmPresetProvider
} from './llmPresets'
import { isFreeModelConfigId } from './freeModels'
import type { FreeModelPublicEntry } from './freeModels'

const isChatModelId = (modelId: string): boolean =>
  !/(image|audio|video|tts|asr|realtime|embedding|rerank|ocr|transcri|whisper|search|speech)/u.test(
    modelId.toLowerCase()
  )

export const isExactRemoteModelAvailable = (
  modelId: string,
  remoteModels: readonly Pick<LlmRemoteModel, 'id'>[]
): boolean => remoteModels.some((item) => item.id === modelId)

/**
 * When the remote list is empty (fetch failed or truly empty), keep presets selectable
 * so a known stable API id can still be used. Non-empty lists require exact id match.
 */
export const isPresetModelAvailableInRemoteList = (
  modelId: string,
  remoteModels: readonly Pick<LlmRemoteModel, 'id'>[]
): boolean => {
  if (remoteModels.length === 0) return true
  return isExactRemoteModelAvailable(modelId, remoteModels)
}

export const pickFirstChatRemoteModel = (
  models: readonly LlmRemoteModel[]
): LlmRemoteModel | undefined => models.find((item) => isChatModelId(item.id))

const pickAvailablePresetModel = (
  provider: LlmPresetProvider,
  remoteModels: readonly Pick<LlmRemoteModel, 'id'>[]
): LlmPresetModel | null => {
  for (const model of provider.models) {
    if (isPresetModelAvailableInRemoteList(model.id, remoteModels)) return model
  }
  return null
}

export const resolveSelectedWorkbenchModel = (input: {
  configs: readonly LLMConfig[]
  modelListsByConfigId: Record<string, readonly LlmRemoteModel[]>
  selected: WorkbenchSelectedModel | null | undefined
  freeModels?: readonly FreeModelPublicEntry[]
}): WorkbenchSelectedModel | null => {
  const selected = input.selected
  if (!selected?.configId || !selected.modelName) return null
  if (isFreeModelConfigId(selected.configId)) {
    // Free catalog is unstable; keep the snapshot while the config id is free-scoped.
    return { configId: selected.configId, modelName: selected.modelName }
  }
  const config = input.configs.find((item) => item.id === selected.configId)
  if (!config) return null

  const remoteModels = input.modelListsByConfigId[config.id] || []

  // Exact id in the remote list is always valid — including custom picks under a
  // recommend config (e.g. dated snapshot ids chosen from the custom view).
  if (isExactRemoteModelAvailable(selected.modelName, remoteModels)) {
    return { configId: config.id, modelName: selected.modelName }
  }

  // Empty remote list (fetch failed): keep known preset ids so recommend configs
  // remain usable; never invent or keep unmatched custom ids.
  if (remoteModels.length === 0) {
    const preset = resolvePresetModeProvider(config)
    if (preset && getPresetModel(preset, selected.modelName)) {
      return { configId: config.id, modelName: selected.modelName }
    }
  }

  return null
}

export const pickFallbackWorkbenchModel = (input: {
  configs: readonly LLMConfig[]
  modelListsByConfigId: Record<string, readonly LlmRemoteModel[]>
  freeModels?: readonly FreeModelPublicEntry[]
}): WorkbenchSelectedModel | null => {
  for (const config of input.configs) {
    const preset = resolvePresetModeProvider(config)
    if (!preset) continue
    const remoteModels = input.modelListsByConfigId[config.id] || []
    const model = pickAvailablePresetModel(preset, remoteModels)
    if (model) return { configId: config.id, modelName: model.id }
  }

  for (const config of input.configs) {
    if (resolvePresetModeProvider(config)) continue
    const remoteModels = input.modelListsByConfigId[config.id] || []
    const model = pickFirstChatRemoteModel(remoteModels)
    if (model) return { configId: config.id, modelName: model.id }
  }

  const firstFree = input.freeModels?.[0]
  if (firstFree) {
    return { configId: firstFree.configId, modelName: firstFree.modelName }
  }

  return null
}
