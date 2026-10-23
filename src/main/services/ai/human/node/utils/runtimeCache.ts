import { getEffectiveLoadedToolsetIds, getToolsetDefinition } from '../../toolsets'
import type { HumanRuntimeCache, RuntimeToolsetId } from '../../types'

export const createHumanRuntimeCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  toolsetTools: {},
  toolCallCount: 0
})

export const getAvailableToolNames = (input: {
  loadedToolsetIds: RuntimeToolsetId[]
}): string[] => {
  const toolNames = new Set<string>()
  getEffectiveLoadedToolsetIds(input.loadedToolsetIds).forEach((toolsetId) => {
    getToolsetDefinition(toolsetId).toolNames.forEach((toolName) => {
      const normalized = String(toolName || '').trim()
      if (!normalized) return
      toolNames.add(normalized)
    })
  })
  return Array.from(toolNames)
}
