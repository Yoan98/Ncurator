export const minExpectedOsThreadDelta = (
  intraOpNumThreads: number,
  platform = process.platform
): number => {
  if (platform === 'win32') return Math.max(0, intraOpNumThreads - 1)
  return intraOpNumThreads
}

export const osThreadDeltaMeetsBudget = (
  delta: number,
  intraOpNumThreads: number,
  platform = process.platform
): boolean => delta >= minExpectedOsThreadDelta(intraOpNumThreads, platform)

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
): boolean =>
  input.fastIntraOp !== input.slowIntraOp &&
  osThreadDeltaMeetsBudget(input.slowDelta, input.slowIntraOp, platform) &&
  osThreadDeltaMeetsBudget(input.fastDelta, input.fastIntraOp, platform) &&
  input.fastDelta - input.slowDelta === input.fastIntraOp - input.slowIntraOp &&
  input.fastAfter > input.slowAfter
