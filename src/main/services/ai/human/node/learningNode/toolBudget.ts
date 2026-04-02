const dedupeInOrder = <TValue extends string>(values: readonly TValue[]): TValue[] => {
  const out: TValue[] = []
  const seen = new Set<TValue>()

  values.forEach((value) => {
    if (seen.has(value)) return
    seen.add(value)
    out.push(value)
  })

  return out
}

const collectToolNames = <TSkillId extends string>(input: {
  skillIds: readonly TSkillId[]
  getToolNames: (skillId: TSkillId) => readonly string[]
}): string[] => {
  const toolNames = new Set<string>()

  dedupeInOrder(input.skillIds).forEach((skillId) => {
    input.getToolNames(skillId).forEach((toolName) => {
      const normalized = String(toolName || '').trim()
      if (normalized) toolNames.add(normalized)
    })
  })

  return Array.from(toolNames)
}

export const countActiveToolNamesForSkillIds = <TSkillId extends string>(input: {
  skillIds: readonly TSkillId[]
  getToolNames: (skillId: TSkillId) => readonly string[]
}): number => collectToolNames(input).length

export const fitSkillIdsToToolBudget = <TSkillId extends string>(input: {
  existingSkillIds: readonly TSkillId[]
  requestedSkillIds: readonly TSkillId[]
  maxActiveTools: number
  getToolNames: (skillId: TSkillId) => readonly string[]
}):
  | {
      ok: true
      learnedSkillIds: TSkillId[]
      evictedSkillIds: TSkillId[]
      activeToolCount: number
    }
  | {
      ok: false
      activeToolCount: number
      requestedSkillIds: TSkillId[]
    } => {
  const existingSkillIds = dedupeInOrder(input.existingSkillIds)
  const requestedSkillIds = dedupeInOrder(input.requestedSkillIds)
  const protectedSkillIds = new Set(requestedSkillIds)
  const learnedSkillIds = dedupeInOrder([...existingSkillIds, ...requestedSkillIds])
  const evictedSkillIds: TSkillId[] = []

  let activeToolCount = countActiveToolNamesForSkillIds({
    skillIds: learnedSkillIds,
    getToolNames: input.getToolNames
  })

  while (activeToolCount > input.maxActiveTools) {
    const evictionIndex = learnedSkillIds.findIndex((skillId) => !protectedSkillIds.has(skillId))
    if (evictionIndex < 0) {
      return {
        ok: false,
        activeToolCount,
        requestedSkillIds
      }
    }

    const [evictedSkillId] = learnedSkillIds.splice(evictionIndex, 1)
    if (evictedSkillId) {
      evictedSkillIds.push(evictedSkillId)
    }

    activeToolCount = countActiveToolNamesForSkillIds({
      skillIds: learnedSkillIds,
      getToolNames: input.getToolNames
    })
  }

  return {
    ok: true,
    learnedSkillIds,
    evictedSkillIds,
    activeToolCount
  }
}
