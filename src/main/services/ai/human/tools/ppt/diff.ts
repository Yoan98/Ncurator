import type {
  PptDiffElementChange,
  PptDiffElementSnapshot,
  PptDiffFrame,
  PptDiffManifest,
  PptDiffSlide,
  PptDiffSlideSnapshot
} from './types'

type Match = {
  before: PptDiffElementSnapshot
  after: PptDiffElementSnapshot
}

const compareIds = (left: { elementId: string }, right: { elementId: string }): number =>
  left.elementId.localeCompare(right.elementId)

const followLineage = (elementId: string, lineage: ReadonlyMap<string, string>): string => {
  const seen = new Set<string>()
  let current = elementId
  while (!seen.has(current)) {
    seen.add(current)
    const next = lineage.get(current)
    if (!next) break
    current = next
  }
  return current
}

export const diffPptElements = (input: {
  before: readonly PptDiffElementSnapshot[]
  after: readonly PptDiffElementSnapshot[]
  lineage?: ReadonlyMap<string, string>
  movedCandidates?: ReadonlySet<string>
}): PptDiffElementChange[] => {
  const lineage = input.lineage || new Map<string, string>()
  const unmatchedBefore = new Map(input.before.map((element) => [element.elementId, element]))
  const unmatchedAfter = new Map(input.after.map((element) => [element.elementId, element]))
  const matches: Match[] = []

  for (const before of input.before) {
    const afterId = unmatchedAfter.has(before.elementId)
      ? before.elementId
      : followLineage(before.elementId, lineage)
    const after = unmatchedAfter.get(afterId)
    if (!after) continue
    matches.push({ before, after })
    unmatchedBefore.delete(before.elementId)
    unmatchedAfter.delete(after.elementId)
  }

  const beforeByFingerprint = new Map<string, PptDiffElementSnapshot[]>()
  for (const element of unmatchedBefore.values()) {
    const entries = beforeByFingerprint.get(element.fingerprint) || []
    entries.push(element)
    beforeByFingerprint.set(element.fingerprint, entries)
  }
  const afterByFingerprint = new Map<string, PptDiffElementSnapshot[]>()
  for (const element of unmatchedAfter.values()) {
    const entries = afterByFingerprint.get(element.fingerprint) || []
    entries.push(element)
    afterByFingerprint.set(element.fingerprint, entries)
  }
  for (const [fingerprint, beforeElements] of beforeByFingerprint) {
    const afterElements = afterByFingerprint.get(fingerprint)
    if (!afterElements) continue
    const sortedBefore = [...beforeElements].sort(compareIds)
    const sortedAfter = [...afterElements].sort(compareIds)
    const pairCount = Math.min(sortedBefore.length, sortedAfter.length)
    for (let index = 0; index < pairCount; index += 1) {
      const before = sortedBefore[index]!
      const after = sortedAfter[index]!
      matches.push({ before, after })
      unmatchedBefore.delete(before.elementId)
      unmatchedAfter.delete(after.elementId)
    }
  }

  const matchedBeforeIds = new Set(matches.map(({ before }) => before.elementId))
  const beforeOrder = input.before
    .filter((element) => matchedBeforeIds.has(element.elementId))
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((element) => element.elementId)
  const beforeIdByAfterId = new Map(
    matches.map(({ before, after }) => [after.elementId, before.elementId])
  )
  const afterOrder = input.after
    .filter((element) => beforeIdByAfterId.has(element.elementId))
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((element) => beforeIdByAfterId.get(element.elementId)!)
  const movedCandidateBeforeIds = new Set(
    matches.flatMap(({ before, after }) =>
      input.movedCandidates?.has(before.elementId) || input.movedCandidates?.has(after.elementId)
        ? [before.elementId]
        : []
    )
  )
  const movedElementIds = resolveMovedIds({
    beforeIds: beforeOrder,
    afterIds: afterOrder,
    movedCandidates: movedCandidateBeforeIds
  })
  const changes: PptDiffElementChange[] = matches.flatMap(({ before, after }) =>
    before.fingerprint === after.fingerprint && !movedElementIds.has(before.elementId)
      ? []
      : [
          {
            kind: 'modified' as const,
            beforeElementId: before.elementId,
            afterElementId: after.elementId
          }
        ]
  )
  changes.push(
    ...[...unmatchedBefore.values()].sort(compareIds).map((element) => ({
      kind: 'deleted' as const,
      beforeElementId: element.elementId
    })),
    ...[...unmatchedAfter.values()].sort(compareIds).map((element) => ({
      kind: 'added' as const,
      afterElementId: element.elementId
    }))
  )
  return changes
}

type LcsScore = { length: number; protectedCount: number; ids: string[] }

const betterScore = (left: LcsScore, right: LcsScore): LcsScore => {
  if (left.length !== right.length) return left.length > right.length ? left : right
  if (left.protectedCount !== right.protectedCount) {
    return left.protectedCount > right.protectedCount ? left : right
  }
  return left.ids.join('\u0000') <= right.ids.join('\u0000') ? left : right
}

const resolveMovedIds = (input: {
  beforeIds: readonly string[]
  afterIds: readonly string[]
  movedCandidates?: ReadonlySet<string>
}): Set<string> => {
  const afterSet = new Set(input.afterIds)
  const beforeSet = new Set(input.beforeIds)
  const before = input.beforeIds.filter((id) => afterSet.has(id))
  const after = input.afterIds.filter((id) => beforeSet.has(id))
  if (
    before.length === after.length &&
    before.every((slideId, index) => slideId === after[index])
  ) {
    return new Set()
  }

  const candidates = input.movedCandidates || new Set<string>()
  const table: LcsScore[][] = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => ({
      length: 0,
      protectedCount: 0,
      ids: []
    }))
  )
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      if (before[left] === after[right]) {
        const next = table[left + 1]![right + 1]!
        const slideId = before[left]!
        table[left]![right] = {
          length: next.length + 1,
          protectedCount: next.protectedCount + (candidates.has(slideId) ? 0 : 1),
          ids: [slideId, ...next.ids]
        }
      } else {
        table[left]![right] = betterScore(table[left + 1]![right]!, table[left]![right + 1]!)
      }
    }
  }
  const stationary = new Set(table[0]![0]!.ids)
  return new Set(before.filter((slideId) => !stationary.has(slideId)))
}

export const resolveMovedPptSlideIds = (input: {
  beforeSlideIds: readonly string[]
  afterSlideIds: readonly string[]
  movedCandidates?: ReadonlySet<string>
}): Set<string> =>
  resolveMovedIds({
    beforeIds: input.beforeSlideIds,
    afterIds: input.afterSlideIds,
    movedCandidates: input.movedCandidates
  })

const replacedElementChanges = (input: {
  before: readonly PptDiffElementSnapshot[]
  after: readonly PptDiffElementSnapshot[]
}): PptDiffElementChange[] => [
  ...[...input.before].sort(compareIds).map((element) => ({
    kind: 'deleted' as const,
    beforeElementId: element.elementId
  })),
  ...[...input.after].sort(compareIds).map((element) => ({
    kind: 'added' as const,
    afterElementId: element.elementId
  }))
]

export const buildPptDiffManifest = (input: {
  beforeSlides: readonly PptDiffSlideSnapshot[]
  afterSlides: readonly PptDiffSlideSnapshot[]
  beforeFrames: ReadonlyMap<string, PptDiffFrame>
  afterFrames: ReadonlyMap<string, PptDiffFrame>
  operation: 'created' | 'updated'
  movedCandidates?: ReadonlySet<string>
  replacedSlideIds?: ReadonlySet<string>
  elementLineage?: ReadonlyMap<string, string>
  movedElementCandidates?: ReadonlySet<string>
}): PptDiffManifest => {
  const beforeById = new Map(input.beforeSlides.map((slide) => [slide.slideId, slide]))
  const afterById = new Map(input.afterSlides.map((slide) => [slide.slideId, slide]))
  const movedSlideIds = resolveMovedPptSlideIds({
    beforeSlideIds: input.beforeSlides.map((slide) => slide.slideId),
    afterSlideIds: input.afterSlides.map((slide) => slide.slideId),
    movedCandidates: input.movedCandidates
  })

  const slides: PptDiffSlide[] = input.afterSlides.map((afterSlide) => {
    const beforeSlide = beforeById.get(afterSlide.slideId)
    const afterFrame = input.afterFrames.get(afterSlide.slideId)
    if (!beforeSlide) {
      return {
        slideId: afterSlide.slideId,
        changed: true,
        changes: ['added'],
        elementChanges: [],
        positiveCount: 1,
        negativeCount: 0,
        after: afterFrame
      }
    }

    const beforeFrame = input.beforeFrames.get(afterSlide.slideId)
    const replaced = Boolean(input.replacedSlideIds?.has(afterSlide.slideId))
    const elementChanges = replaced
      ? replacedElementChanges({ before: beforeSlide.elements, after: afterSlide.elements })
      : diffPptElements({
          before: beforeSlide.elements,
          after: afterSlide.elements,
          lineage: input.elementLineage,
          movedCandidates: input.movedElementCandidates
        })
    const pageModified =
      replaced || beforeSlide.pageFingerprint !== afterSlide.pageFingerprint
    const contentModified = pageModified || elementChanges.length > 0
    const moved = movedSlideIds.has(afterSlide.slideId)
    const changes: PptDiffSlide['changes'] = []
    if (contentModified) changes.push('modified')
    if (moved) changes.push('moved')
    return {
      slideId: afterSlide.slideId,
      changed: changes.length > 0,
      changes,
      elementChanges,
      positiveCount: replaced
        ? elementChanges.filter((change) => change.kind === 'added').length + (moved ? 1 : 0)
        : elementChanges.filter((change) => change.kind !== 'deleted').length +
          (pageModified ? 1 : 0) +
          (moved ? 1 : 0),
      negativeCount: elementChanges.filter((change) => change.kind === 'deleted').length,
      before: beforeFrame,
      after: afterFrame
    }
  })

  const deletedSlides = input.beforeSlides.filter((slide) => !afterById.has(slide.slideId))
  for (const beforeSlide of deletedSlides) {
    slides.splice(Math.min(Math.max(0, beforeSlide.index - 1), slides.length), 0, {
      slideId: beforeSlide.slideId,
      changed: true,
      changes: ['deleted'],
      elementChanges: [],
      positiveCount: 0,
      negativeCount: 1,
      before: input.beforeFrames.get(beforeSlide.slideId),
      after: undefined
    })
  }

  return {
    version: 4,
    operation: input.operation,
    positiveCount: slides.reduce((sum, slide) => sum + slide.positiveCount, 0),
    negativeCount: slides.reduce((sum, slide) => sum + slide.negativeCount, 0),
    slides
  }
}
