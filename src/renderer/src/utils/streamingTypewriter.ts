/**
 * Catch-up typewriter for streamed Markdown.
 *
 * Provider chunks arrive in bursts (median gap 3ms, p90 85ms), so painting them
 * as they land looks jerky. The typewriter keeps a display cursor that lags the
 * received text and advances it at a bounded rate, turning bursts into a steady
 * flow while never falling far behind.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 节奏计算已移到 `src/shared/typewriterPacing.ts`（纯逻辑，便于 unit 覆盖）。
 * 这里保留原导出路径，并把同一份常量与函数用于下面的 hook。
 */
import { TYPING_TICK_MS, nextTypedLength } from '../../../shared/typewriterPacing'

export { TYPING_TICK_MS, nextTypedLength }

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
