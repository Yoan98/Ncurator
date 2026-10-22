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

const collectToolNames = <TToolsetId extends string>(input: {
  toolsetIds: readonly TToolsetId[]
  getToolNames: (toolsetId: TToolsetId) => readonly string[]
}): string[] => {
  const toolNames = new Set<string>()

  dedupeInOrder(input.toolsetIds).forEach((toolsetId) => {
    input.getToolNames(toolsetId).forEach((toolName) => {
      const normalized = String(toolName || '').trim()
      if (normalized) toolNames.add(normalized)
    })
  })

  return Array.from(toolNames)
}

export const countActiveToolNamesForToolsetIds = <TToolsetId extends string>(input: {
  toolsetIds: readonly TToolsetId[]
  getToolNames: (toolsetId: TToolsetId) => readonly string[]
  baseToolNames?: readonly string[]
}): number =>
  new Set([
    ...(input.baseToolNames || []).map((name) => String(name || '').trim()).filter(Boolean),
    ...collectToolNames(input)
  ]).size

export const fitToolsetIdsToToolBudget = <TToolsetId extends string>(input: {
  existingToolsetIds: readonly TToolsetId[]
  requestedToolsetIds: readonly TToolsetId[]
  maxActiveTools: number
  getToolNames: (toolsetId: TToolsetId) => readonly string[]
  baseToolNames?: readonly string[]
}):
  | {
      ok: true
      loadedToolsetIds: TToolsetId[]
      evictedToolsetIds: TToolsetId[]
      activeToolCount: number
    }
  | {
      ok: false
      activeToolCount: number
      requestedToolsetIds: TToolsetId[]
    } => {
  const existingToolsetIds = dedupeInOrder(input.existingToolsetIds)
  const requestedToolsetIds = dedupeInOrder(input.requestedToolsetIds)
  const protectedToolsetIds = new Set(requestedToolsetIds)
  const loadedToolsetIds = dedupeInOrder([...existingToolsetIds, ...requestedToolsetIds])
  const evictedToolsetIds: TToolsetId[] = []

  let activeToolCount = countActiveToolNamesForToolsetIds({
    toolsetIds: loadedToolsetIds,
    getToolNames: input.getToolNames,
    baseToolNames: input.baseToolNames
  })

  while (activeToolCount > input.maxActiveTools) {
    const evictionIndex = loadedToolsetIds.findIndex(
      (toolsetId) => !protectedToolsetIds.has(toolsetId)
    )
    if (evictionIndex < 0) {
      return {
        ok: false,
        activeToolCount,
        requestedToolsetIds
      }
    }

    const [evictedToolsetId] = loadedToolsetIds.splice(evictionIndex, 1)
    if (evictedToolsetId) {
      evictedToolsetIds.push(evictedToolsetId)
    }

    activeToolCount = countActiveToolNamesForToolsetIds({
      toolsetIds: loadedToolsetIds,
      getToolNames: input.getToolNames,
      baseToolNames: input.baseToolNames
    })
  }

  return {
    ok: true,
    loadedToolsetIds,
    evictedToolsetIds,
    activeToolCount
  }
}
