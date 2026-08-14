import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition
} from '../../skills'
import type { HumanRuntimeCache, RuntimeSkillId } from '../../types'

export const createHumanRuntimeCache = (): HumanRuntimeCache => ({
  familyToolsets: {},
  skillToolsets: {},
  toolCallCount: 0
})

export const getAvailableToolNames = (input: {
  learnedSkillIds: RuntimeSkillId[]
}): string[] => {
  const toolNames = new Set<string>()
  getEffectiveLearnedSkillIds(input.learnedSkillIds).forEach((skillId) => {
    getSkillDefinition(skillId).toolNames.forEach((toolName) => {
      const normalized = String(toolName || '').trim()
      if (!normalized) return
      toolNames.add(normalized)
    })
  })
  return Array.from(toolNames)
}
