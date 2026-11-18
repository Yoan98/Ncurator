/**
 * Catch-up typewriter for streamed Markdown.
 *
 * Provider chunks arrive in bursts (median gap 3ms, p90 85ms), so painting them
 * as they land looks jerky. The typewriter keeps a display cursor that lags the
 * received text and advances it at a bounded rate, turning bursts into a steady
 * flow while never falling far behind.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

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

/**
 * Returns `target` progressively. When disabled the full text is returned
 * immediately (used by e2e, the settings toggle and reduced-motion users).
 */
export const useTypewriterText = (target: string, enabled: boolean): string => {
  const [typedLength, setTypedLength] = useState(() => (enabled ? 0 : target.length))
  const typedRef = useRef(typedLength)
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      typedRef.current = target.length
      setTypedLength(target.length)
      return
    }

    if (typedRef.current > target.length) {
      typedRef.current = target.length
      setTypedLength(target.length)
    }
    if (typedRef.current >= target.length) return

    // Long tails parse slower; drop to ~20fps instead of spending the frame budget.
    const tickMs = target.length > 1200 ? TYPING_TICK_MS * 1.5 : TYPING_TICK_MS
    const tick = (timestamp: number): void => {
      const elapsed = lastTickRef.current > 0 ? timestamp - lastTickRef.current : tickMs
      if (elapsed >= tickMs) {
        lastTickRef.current = timestamp
        const next = nextTypedLength({
          displayed: typedRef.current,
          target: target.length,
          elapsedMs: elapsed
        })
        if (next !== typedRef.current) {
          typedRef.current = next
          setTypedLength(next)
        }
      }
      frameRef.current = typedRef.current < target.length ? requestAnimationFrame(tick) : null
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      lastTickRef.current = 0
    }
  }, [target, enabled])

  return useMemo(() => {
    if (!enabled) return target
    const visible = Math.min(typedLength, target.length)
    return visible >= target.length ? target : target.slice(0, visible)
  }, [enabled, target, typedLength])
}
