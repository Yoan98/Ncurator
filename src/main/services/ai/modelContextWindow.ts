import {
  freeModelEntryIdFromConfigId,
  isFreeModelConfigId
} from '../../../shared/freeModels'
import type { WorkbenchSelectedModel } from '../../../shared/types'
import { FreeModelCatalogService } from '../llm/FreeModelCatalogService'
import { PresetModelCatalogService } from '../llm/PresetModelCatalogService'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveModelContextTokens
} from './human/constants'

export const lookupCatalogModelContextTokens = (
  selection?: Pick<WorkbenchSelectedModel, 'configId' | 'modelName'> | null
): number => {
  const configId = String(selection?.configId || '').trim()
  const modelName = String(selection?.modelName || '').trim()
  if (configId && isFreeModelConfigId(configId)) {
    const entryId = freeModelEntryIdFromConfigId(configId)
    const entry = entryId ? FreeModelCatalogService.getInstance().findEntryById(entryId) : null
    return resolveModelContextTokens(entry?.contextWindowTokens)
  }
  if (modelName) {
    const preset = PresetModelCatalogService.getInstance().findModelById(modelName)
    if (preset) return resolveModelContextTokens(preset.contextWindowTokens)
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
}
