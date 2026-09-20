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

/**
 * Ready-state after counts may be the only signal when the embedding worker was
 * already warm on Windows (measurement starts after ORT threads are up).
 */
export const osThreadAfterCountsFollowIndexSpeed = (
  input: {
    slowAfter: number
    fastAfter: number
    slowIntraOp: number
    fastIntraOp: number
  },
  platform = process.platform
): boolean => {
  if (platform !== "win32") return false
  const budgetDiff = input.fastIntraOp - input.slowIntraOp
  if (budgetDiff <= 0) return false
  if (!(input.fastAfter > input.slowAfter)) return false
  const afterDiff = input.fastAfter - input.slowAfter
  return Math.abs(afterDiff - budgetDiff) <= 1
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
  // Warm-worker path only: both deltas stayed at 0 because ORT was already ready.
  if (platform === "win32" && input.slowDelta === 0 && input.fastDelta === 0) {
    return osThreadAfterCountsFollowIndexSpeed(input, platform)
  }
  return false
}
