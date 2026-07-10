import type { LLMConfig } from '../../../shared/types'

export type { LLMConfig }

// Helper to check whether any LLM config is available.
export const getActiveConfig = async (): Promise<LLMConfig | null> => {
  try {
    const configs = await window.api.llmConfigList()
    return configs[0] || null
  } catch (e) {
    console.error('Failed to load LLM configs', e)
    return null
  }
}
