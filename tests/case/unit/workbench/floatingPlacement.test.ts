import { describe, expect, it } from 'vitest'
import { resolveFloatingPlacement } from '../../../../src/renderer/src/components/workbench/floatingPlacement'

describe('workbench floating placement', () => {
  it('opens upward when bottom space is insufficient and top space is larger', () => {
    const placement = resolveFloatingPlacement({
      triggerRect: {
        top: 700,
        bottom: 740,
        left: 900,
        right: 1000
      },
      viewportWidth: 1280,
      viewportHeight: 800,
      preferredWidth: 360,
      preferredHeight: 320
    })

    expect(placement.placement).toBe('top')
    expect(placement.bottom).toBeDefined()
    expect(placement.top).toBeUndefined()
    expect(placement.maxHeight).toBeGreaterThan(0)
  })

  it('keeps downward placement when there is enough space below', () => {
    const placement = resolveFloatingPlacement({
      triggerRect: {
        top: 100,
        bottom: 140,
        left: 80,
        right: 180
      },
      viewportWidth: 1280,
      viewportHeight: 800,
      preferredWidth: 360,
      preferredHeight: 320
    })

    expect(placement.placement).toBe('bottom')
    expect(placement.top).toBe(148)
    expect(placement.bottom).toBeUndefined()
  })
})
