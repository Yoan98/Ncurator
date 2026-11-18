import { describe, expect, it } from 'vitest'
import {
  nextTypedLength,
  TYPING_TICK_MS
} from '../../../../src/renderer/src/utils/streamingTypewriter'

describe('nextTypedLength', () => {
  it('stays at the target when caught up', () => {
    expect(nextTypedLength({ displayed: 10, target: 10, elapsedMs: 32 })).toBe(10)
    expect(nextTypedLength({ displayed: 12, target: 10, elapsedMs: 32 })).toBe(10)
  })

  it('always advances at least one character when text is pending', () => {
    expect(nextTypedLength({ displayed: 0, target: 1, elapsedMs: 1 })).toBe(1)
    expect(nextTypedLength({ displayed: 0, target: 5, elapsedMs: 1 })).toBe(1)
  })

  it('types faster as the backlog grows, up to a cap', () => {
    const backlog5 = nextTypedLength({ displayed: 0, target: 5, elapsedMs: TYPING_TICK_MS })
    const backlog100 = nextTypedLength({ displayed: 0, target: 100, elapsedMs: TYPING_TICK_MS })
    const backlog400 = nextTypedLength({ displayed: 0, target: 400, elapsedMs: TYPING_TICK_MS })
    expect(backlog5).toBeLessThan(backlog100)
    expect(backlog400).toBeGreaterThanOrEqual(backlog100 - 1)
    // The cap keeps a single tick under a readable burst (~8 chars per 32ms).
    expect(backlog400).toBeLessThanOrEqual(10)
  })

  it('snaps when the display falls far behind', () => {
    expect(nextTypedLength({ displayed: 0, target: 2000, elapsedMs: TYPING_TICK_MS })).toBe(2000)
  })

  it('never overshoots the target', () => {
    const next = nextTypedLength({ displayed: 99, target: 100, elapsedMs: 1000 })
    expect(next).toBe(100)
  })
})
