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

  it('caps max height when an explicit limit is provided', () => {
    const placement = resolveFloatingPlacement({
      triggerRect: {
        top: 300,
        bottom: 340,
        left: 200,
        right: 300
      },
      viewportWidth: 1280,
      viewportHeight: 800,
      preferredWidth: 360,
      preferredHeight: 500,
      maxHeight: 240
    })

    expect(placement.maxHeight).toBe(240)
  })

  it('can align the floating width to the trigger right edge', () => {
    const placement = resolveFloatingPlacement({
      triggerRect: {
        top: 620,
        bottom: 650,
        left: 1400,
        right: 1580
      },
      viewportWidth: 1800,
      viewportHeight: 900,
      preferredWidth: 440,
      preferredHeight: 320,
      align: 'end'
    })

    expect(placement.left).toBe(1140)
    expect(placement.left + placement.width).toBe(1580)
  })

  it('keeps a compact model menu below the trigger when it fits', () => {
    const placement = resolveFloatingPlacement({
      triggerRect: {
        top: 435,
        bottom: 463,
        left: 907,
        right: 1087
      },
      viewportWidth: 1280,
      viewportHeight: 800,
      preferredWidth: 440,
      preferredHeight: 300,
      maxHeight: 300,
      align: 'end'
    })

    expect(placement.placement).toBe('bottom')
    expect(placement.top).toBe(471)
    expect(placement.left + placement.width).toBe(1087)
  })
})
