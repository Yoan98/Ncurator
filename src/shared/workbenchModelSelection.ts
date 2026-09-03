import type { LLMConfig, LlmRemoteModel, WorkbenchSelectedModel } from './types'
import {
  getPresetModel,
  resolvePresetModeProvider,
  type LlmPresetModel,
  type LlmPresetProvider
} from './llmPresets'

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
}): WorkbenchSelectedModel | null => {
  const selected = input.selected
  if (!selected?.configId || !selected.modelName) return null
  const config = input.configs.find((item) => item.id === selected.configId)
  if (!config) return null

  const remoteModels = input.modelListsByConfigId[config.id] || []
  const preset = resolvePresetModeProvider(config)
  if (preset) {
    const presetModel = getPresetModel(preset, selected.modelName)
    if (!presetModel) return null
    if (!isPresetModelAvailableInRemoteList(selected.modelName, remoteModels)) return null
    return { configId: config.id, modelName: selected.modelName }
  }

  if (!isExactRemoteModelAvailable(selected.modelName, remoteModels)) return null
  return { configId: config.id, modelName: selected.modelName }
}

export const pickFallbackWorkbenchModel = (input: {
  configs: readonly LLMConfig[]
  modelListsByConfigId: Record<string, readonly LlmRemoteModel[]>
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

  return null
}
