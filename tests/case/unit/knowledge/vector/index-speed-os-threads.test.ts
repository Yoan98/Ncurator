import { describe, expect, it } from 'vitest'
import {
  minExpectedOsThreadDelta,
  osThreadDeltaMeetsBudget,
  osThreadDeltasFollowIndexSpeed
} from '../../../../harness/core/indexSpeedThreads'

describe('index speed OS thread accounting', () => {
  it('accepts Windows N-1 ORT thread delta and keeps Mac at full intraOp', () => {
    expect(minExpectedOsThreadDelta(8, 'win32')).toBe(7)
    expect(minExpectedOsThreadDelta(1, 'win32')).toBe(0)
    expect(minExpectedOsThreadDelta(8, 'darwin')).toBe(8)
    expect(osThreadDeltaMeetsBudget(7, 8, 'win32')).toBe(true)
    expect(osThreadDeltaMeetsBudget(6, 8, 'win32')).toBe(false)
    expect(osThreadDeltaMeetsBudget(7, 8, 'darwin')).toBe(false)
    expect(osThreadDeltaMeetsBudget(8, 8, 'darwin')).toBe(true)
  })

  it('requires slow/fast deltas to track the intraOp gap', () => {
    expect(
      osThreadDeltasFollowIndexSpeed(
        {
          slowDelta: 3,
          fastDelta: 6,
          slowAfter: 10,
          fastAfter: 13,
          slowIntraOp: 4,
          fastIntraOp: 7
        },
        'win32'
      )
    ).toBe(true)
    expect(
      osThreadDeltasFollowIndexSpeed(
        {
          slowDelta: 4,
          fastDelta: 7,
          slowAfter: 10,
          fastAfter: 13,
          slowIntraOp: 4,
          fastIntraOp: 7
        },
        'darwin'
      )
    ).toBe(true)
    expect(
      osThreadDeltasFollowIndexSpeed(
        {
          slowDelta: 3,
          fastDelta: 6,
          slowAfter: 10,
          fastAfter: 13,
          slowIntraOp: 4,
          fastIntraOp: 7
        },
        'darwin'
      )
    ).toBe(false)
    expect(
      osThreadDeltasFollowIndexSpeed(
        {
          slowDelta: 3,
          fastDelta: 5,
          slowAfter: 10,
          fastAfter: 12,
          slowIntraOp: 4,
          fastIntraOp: 7
        },
        'win32'
      )
    ).toBe(false)
  })
})
