import type { LLMConfig, LlmRemoteModel, WorkbenchSelectedModel } from './types'
import {
  getPresetModel,
  resolvePresetModeProvider,
  type LlmEffort,
  type LlmPresetModel,
  type LlmPresetProvider
} from './llmPresets'
import { isFreeModelConfigId } from './freeModels'
import type { FreeModelPublicEntry } from './freeModels'
import { isManagedModelConfigId } from './managedModels'

/**
 * 取当前选中模型对外开放的思考强度选项。目录没有返回配置时返回 undefined，
 * 界面据此不显示强度控件。
 */
export const findSelectionEffort = (input: {
  selected: WorkbenchSelectedModel | null | undefined
  configs: readonly LLMConfig[]
  presetProviders?: readonly LlmPresetProvider[]
  managedEfforts?: readonly { id: string; effort?: LlmEffort }[]
}): LlmEffort | undefined => {
  const selected = input.selected
  if (!selected?.configId || !selected.modelName) return undefined
  if (isManagedModelConfigId(selected.configId)) {
    return input.managedEfforts?.find((model) => selected.configId === `managed:${model.id}`)?.effort
  }
  if (isFreeModelConfigId(selected.configId)) return undefined
  const config = input.configs.find((item) => item.id === selected.configId)
  if (!config) return undefined
  const preset = resolvePresetModeProvider(config)
  if (!preset) return undefined
  const catalog = input.presetProviders?.find((provider) => provider.providerId === preset.providerId)
  return catalog ? getPresetModel(catalog, selected.modelName)?.effort : undefined
}

/**
 * 以当前模型可用的强度选项校正已保存的选择。换模型、目录刷新后旧档位可能不再可用，
 * 这时回落到该模型默认档，不能把幽灵值发给服务端。
 */
/**
 * 校验已选档位是否仍可用；不可用则回落到该模型的默认档。
 *
 * 关键：`effort` 为 undefined 表示「还不知道该模型的档位」，不是「该模型没有档位」。
 * 目录尚未加载、切换伙伴的瞬间都会传入 undefined，此时必须原样保留已选档位，
 * 否则每次刷新/切换都会把用户选的档位清掉。
 */
export const normalizeSelectionEffort = (
  selection: WorkbenchSelectedModel | null,
  effort: LlmEffort | undefined
): WorkbenchSelectedModel | null => {
  if (!selection) return null
  // 档位未知：保留现状，等目录加载完再判定。
  if (!effort) return selection
  const value = effort.options.some((option) => option.value === selection.effort)
    ? selection.effort
    : effort.default
  if (selection.effort === value) return selection
  const next: WorkbenchSelectedModel = { configId: selection.configId, modelName: selection.modelName }
  if (selection.manual) next.manual = true
  if (value !== undefined) next.effort = value
  return next
}

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

const findCatalogProvider = (
  presetProviders: readonly LlmPresetProvider[] | undefined,
  providerId: string
): LlmPresetProvider | null =>
  presetProviders?.find((provider) => provider.providerId === providerId) || null

export const resolveSelectedWorkbenchModel = (input: {
  configs: readonly LLMConfig[]
  modelListsByConfigId: Record<string, readonly LlmRemoteModel[]>
  selected: WorkbenchSelectedModel | null | undefined
  freeModels?: readonly FreeModelPublicEntry[]
  presetProviders?: readonly LlmPresetProvider[]
}): WorkbenchSelectedModel | null => {
  const selected = input.selected
  if (!selected?.configId || !selected.modelName) return null
  // 该函数只解析“选择身份”，身份成立时必须回带强度，否则重启、目录刷新和恢复快照都会丢档位。
  const keep = (next: WorkbenchSelectedModel): WorkbenchSelectedModel =>
    selected.effort === undefined ? next : { ...next, effort: selected.effort }
  if (isManagedModelConfigId(selected.configId)) {
    return keep({ configId: selected.configId, modelName: selected.modelName })
  }
  if (isFreeModelConfigId(selected.configId)) {
    const entry = input.freeModels?.find(
      (model) => model.configId === selected.configId && model.modelName === selected.modelName
    )
    // 免费模型不提供强度开关，身份成立也不回带。
    return entry ? { configId: entry.configId, modelName: entry.modelName } : null
  }
  const config = input.configs.find((item) => item.id === selected.configId)
  if (!config) return null

  // An explicit manual choice does not depend on the discovery endpoint.
  if (selected.manual === true || config.manualModels?.includes(selected.modelName)) {
    return keep({ configId: config.id, modelName: selected.modelName, manual: true })
  }

  const remoteModels = input.modelListsByConfigId[config.id] || []

  // Exact id in the remote list is always valid — including custom picks under a
  // recommend config (e.g. dated snapshot ids chosen from the custom view).
  if (isExactRemoteModelAvailable(selected.modelName, remoteModels)) {
    return keep({ configId: config.id, modelName: selected.modelName })
  }

  // Empty remote list (fetch failed): keep selection if it is still a preset config
  // and (when catalog is loaded) the id exists in the paid preset catalog.
  if (remoteModels.length === 0) {
    const preset = resolvePresetModeProvider(config)
    if (!preset) return null
    const catalog = findCatalogProvider(input.presetProviders, preset.providerId)
    if (!catalog) {
      // Catalog not loaded yet — keep selection on preset configs.
      return keep({ configId: config.id, modelName: selected.modelName })
    }
    if (getPresetModel(catalog, selected.modelName)) {
      return keep({ configId: config.id, modelName: selected.modelName })
    }
  }

  return null
}

export const pickFallbackWorkbenchModel = (input: {
  configs: readonly LLMConfig[]
  modelListsByConfigId: Record<string, readonly LlmRemoteModel[]>
  freeModels?: readonly FreeModelPublicEntry[]
  presetProviders?: readonly LlmPresetProvider[]
}): WorkbenchSelectedModel | null => {
  for (const config of input.configs) {
    const preset = resolvePresetModeProvider(config)
    if (!preset) continue
    const catalog = findCatalogProvider(input.presetProviders, preset.providerId)
    if (!catalog) continue
    const remoteModels = input.modelListsByConfigId[config.id] || []
    const model = pickAvailablePresetModel(catalog, remoteModels)
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
