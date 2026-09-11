export const countOutlineRootNodes = (
  segments: readonly { fromNodeIndex: number; toNodeIndex: number }[]
): number =>
  segments.reduce(
    (total, segment) => total + segment.toNodeIndex - segment.fromNodeIndex + 1,
    0
  )

export const resolveOutlinePercentNodeRange = (input: {
  fromPercent: number
  toPercent: number
  totalRootCount: number
}): { fromNodeIndex: number; toNodeIndex: number } | undefined => {
  if (input.totalRootCount <= 0) return undefined
  const fromNodeIndex = Math.min(
    input.totalRootCount - 1,
    Math.floor((input.fromPercent / 100) * input.totalRootCount)
  )
  const toExclusive = Math.max(
    fromNodeIndex + 1,
    Math.min(input.totalRootCount, Math.ceil((input.toPercent / 100) * input.totalRootCount))
  )
  return { fromNodeIndex, toNodeIndex: toExclusive - 1 }
}

export const selectOutlineSegmentsForNodeRange = <
  TSegment extends { fromNodeIndex: number; toNodeIndex: number }
>(
  segments: readonly TSegment[],
  range: { fromNodeIndex: number; toNodeIndex: number }
): TSegment[] =>
  segments.filter(
    (segment) =>
      segment.toNodeIndex >= range.fromNodeIndex && segment.fromNodeIndex <= range.toNodeIndex
  )
