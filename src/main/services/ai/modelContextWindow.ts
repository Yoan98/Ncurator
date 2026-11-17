import {
  freeModelEntryIdFromConfigId,
  isFreeModelConfigId
} from '../../../shared/freeModels'
import { managedModelEntryId } from '../../../shared/managedModels'
import type { WorkbenchSelectedModel } from '../../../shared/types'
import { FreeModelCatalogService } from '../llm/FreeModelCatalogService'
import { PresetModelCatalogService } from '../llm/PresetModelCatalogService'
import { currentDomesticDesktopAccount, readManagedModels } from '../officialApi/desktopAccount'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveModelContextTokens
} from './human/constants'

export const lookupCatalogModelContextTokens = async (
  selection?: Pick<WorkbenchSelectedModel, 'configId' | 'modelName'> | null
): Promise<number> => {
  const configId = String(selection?.configId || '').trim()
  const modelName = String(selection?.modelName || '').trim()
  const managedId = managedModelEntryId(configId)
  if (managedId) {
    try {
      const catalog = await readManagedModels(currentDomesticDesktopAccount(), false)
      const entry = catalog.status === 'ready' ? catalog.models.find(model => model.id === managedId) : undefined
      return resolveModelContextTokens(entry?.contextWindowTokens)
    } catch {
      return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    }
  }
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
