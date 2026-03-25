import type { HumanRuntimeCache, RuntimeSkillId } from '../../types'

export const createHumanRuntimeCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  skillToolsets: {},
  toolCallCount: 0
})

export const getAvailableToolNames = (input: {
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): string[] => {
  const toolNames = new Set<string>()
  input.learnedSkillIds.forEach((skillId) => {
    ;(input.cache.skillToolsets[skillId] || []).forEach((tool) => {
      const toolName = String(tool.name || '').trim()
      if (toolName) toolNames.add(toolName)
    })
  })
  return Array.from(toolNames)
}
