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
  allowedToolNames?: readonly string[]
}): string[] => {
  const toolNames = new Set<string>()
  const allowedToolNameSet = input.allowedToolNames
    ? new Set(input.allowedToolNames.map((toolName) => String(toolName || '').trim()).filter(Boolean))
    : null
  getEffectiveLearnedSkillIds(input.learnedSkillIds).forEach((skillId) => {
    getSkillDefinition(skillId).toolNames.forEach((toolName) => {
      const normalized = String(toolName || '').trim()
      if (!normalized) return
      if (allowedToolNameSet && !allowedToolNameSet.has(normalized)) return
      toolNames.add(normalized)
    })
  })
  return Array.from(toolNames)
}
