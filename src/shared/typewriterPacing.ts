/**
 * Catch-up typewriter pacing.
 *
 * Provider chunks arrive in bursts (median gap 3ms, p90 85ms), so painting them
 * as they land looks jerky. The display cursor lags the received text and
 * advances at a bounded rate, turning bursts into a steady flow while never
 * falling far behind.
 *
 * 这里只放与 React 无关的节奏计算；按帧推进由 renderer 的 hook 负责。
 */

/** One display tick; ~30fps is enough for text and halves the parse cost. */
export const TYPING_TICK_MS = 32

const MIN_CHARS_PER_MS = 0.02
const MAX_CHARS_PER_MS = 0.25
const BACKLOG_FACTOR = 0.015
/** When the display falls this far behind, stop animating and snap. */
const SNAP_BACKLOG_CHARS = 900

export const nextTypedLength = (input: {
  displayed: number
  target: number
  elapsedMs: number
}): number => {
  const { displayed, target, elapsedMs } = input
  if (displayed >= target) return target
  const backlog = target - displayed
  if (backlog >= SNAP_BACKLOG_CHARS) return target
  const charsPerMs = Math.min(
    MAX_CHARS_PER_MS,
    Math.max(MIN_CHARS_PER_MS, backlog * BACKLOG_FACTOR)
  )
  const step = Math.max(1, Math.round(charsPerMs * Math.max(elapsedMs, 16)))
  return Math.min(target, displayed + step)
}
