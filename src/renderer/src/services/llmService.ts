import type { LLMConfig } from '../../../shared/types'

export type { LLMConfig }

// Helper to get active config asynchronously
export const getActiveConfig = async (): Promise<LLMConfig | null> => {
  try {
    const configs = await window.api.llmConfigList()
    return configs.find((c) => c.is_active) || null
  } catch (e) {
    console.error('Failed to load LLM configs', e)
    return null
  }
}
