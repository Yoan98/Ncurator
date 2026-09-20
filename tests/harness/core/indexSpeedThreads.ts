export const minExpectedOsThreadDelta = (
  intraOpNumThreads: number,
  platform = process.platform
): number => {
  if (platform === "win32") return Math.max(0, intraOpNumThreads - 1)
  return intraOpNumThreads
}

export const osThreadDeltaMeetsBudget = (
  delta: number,
  intraOpNumThreads: number,
  platform = process.platform
): boolean => delta >= minExpectedOsThreadDelta(intraOpNumThreads, platform)

/** Ready-state after counts may be the only signal when the embedding worker was already warm. */
export const osThreadAfterCountsFollowIndexSpeed = (
  input: {
    slowAfter: number
    fastAfter: number
    slowIntraOp: number
    fastIntraOp: number
  },
  platform = process.platform
): boolean => {
  const budgetDiff = input.fastIntraOp - input.slowIntraOp
  if (budgetDiff <= 0) return false
  if (!(input.fastAfter > input.slowAfter)) return false
  const afterDiff = input.fastAfter - input.slowAfter
  const tolerance = platform === "win32" ? 1 : 0
  return Math.abs(afterDiff - budgetDiff) <= tolerance
}

export const osThreadDeltasFollowIndexSpeed = (
  input: {
    slowDelta: number
    fastDelta: number
    slowAfter: number
    fastAfter: number
    slowIntraOp: number
    fastIntraOp: number
  },
  platform = process.platform
): boolean => {
  if (input.fastIntraOp === input.slowIntraOp) return false
  const deltaPath =
    osThreadDeltaMeetsBudget(input.slowDelta, input.slowIntraOp, platform) &&
    osThreadDeltaMeetsBudget(input.fastDelta, input.fastIntraOp, platform) &&
    input.fastDelta - input.slowDelta === input.fastIntraOp - input.slowIntraOp &&
    input.fastAfter > input.slowAfter
  if (deltaPath) return true
  // E2E: embedding worker often reaches ready before measurement can sample the ramp.
  return osThreadAfterCountsFollowIndexSpeed(input, platform)
}
