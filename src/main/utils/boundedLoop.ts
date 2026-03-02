export type BoundedLoopFailureReason = 'timeout' | 'max_steps'

export type BoundedLoopResult<T> =
  | {
      ok: true
      rounds: number
      value: T
    }
  | {
      ok: false
      rounds: number
      reason: BoundedLoopFailureReason
    }

export const runBoundedLoop = async <T>(input: {
  maxSteps: number
  timeoutMs: number
  onRound: (round: number) => Promise<{ done: true; value: T } | { done: false }>
}): Promise<BoundedLoopResult<T>> => {
  const maxSteps = Math.max(1, Number(input.maxSteps || 1))
  const timeoutMs = Math.max(100, Number(input.timeoutMs || 100))
  const startedAt = Date.now()

  for (let round = 1; round <= maxSteps; round += 1) {
    if (Date.now() - startedAt > timeoutMs) {
      return {
        ok: false,
        rounds: round - 1,
        reason: 'timeout'
      }
    }
    const roundResult = await input.onRound(round)
    if (roundResult.done) {
      return {
        ok: true,
        rounds: round,
        value: roundResult.value
      }
    }
  }

  return {
    ok: false,
    rounds: maxSteps,
    reason: 'max_steps'
  }
}
