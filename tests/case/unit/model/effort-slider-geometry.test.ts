import { describe, expect, it } from 'vitest'
import {
  EFFORT_THUMB_RADIUS,
  EFFORT_THUMB_SIZE,
  EFFORT_TRACK_HEIGHT,
  effortFillWidth,
  effortIndexFromOffset,
  effortStopPositions
} from '../../../../src/shared/effortSliderGeometry'

const WIDTH = 262

describe('effort slider geometry', () => {
  it('insets the first and last stop by exactly the thumb radius', () => {
    const points = effortStopPositions(WIDTH, 3)
    // 内缩量 = 滑块半径，这样首末档的圆点正好与轨道两端相切，不会探出轨道。
    expect(points[0]).toBe(EFFORT_THUMB_RADIUS)
    expect(points[2]).toBe(WIDTH - EFFORT_THUMB_RADIUS)
    expect(points[1]).toBe((points[0] + points[2]) / 2)
  })

  it('draws the fill from the track start to the thumb left edge', () => {
    const points = effortStopPositions(WIDTH, 3)
    // 首档：滑块左缘就在轨道起点，填充长度为 0，整条是灰轨道。
    expect(effortFillWidth(points[0])).toBe(0)
    // 中间档：填充止于滑块左缘，不是滑块中心。
    expect(effortFillWidth(points[1])).toBe(points[1] - EFFORT_THUMB_RADIUS)
    // 末档同理。
    expect(effortFillWidth(points[2])).toBe(WIDTH - EFFORT_THUMB_RADIUS * 2)
  })

  it('keeps the thumb centred on a stop for every index', () => {
    // 组件把圆点放在 points[index] 上并左移半径，所以圆心恒等于点位。
    for (const count of [2, 3, 4, 6]) {
      const points = effortStopPositions(WIDTH, count)
      expect(points).toHaveLength(count)
      for (let index = 0; index < count; index += 1) {
        expect(points[index]).toBeGreaterThanOrEqual(EFFORT_THUMB_RADIUS - 1e-9)
        expect(points[index]).toBeLessThanOrEqual(WIDTH - EFFORT_THUMB_RADIUS + 1e-9)
      }
    }
  })

  it('puts a single stop in the middle so a one-tier model still renders sensibly', () => {
    expect(effortStopPositions(WIDTH, 1)).toEqual([WIDTH / 2])
    expect(effortIndexFromOffset(10, WIDTH, 1)).toBe(0)
  })

  it('snaps the drag position to the nearest stop', () => {
    const points = effortStopPositions(WIDTH, 3)
    // 落在某个点附近（含偏差）都要吸附到该点。
    points.forEach((point, index) => {
      expect(effortIndexFromOffset(point, WIDTH, 3)).toBe(index)
      expect(effortIndexFromOffset(point + 8, WIDTH, 3)).toBe(index)
      expect(effortIndexFromOffset(point - 8, WIDTH, 3)).toBe(index)
    })
  })

  it('clamps the drag position outside the track to the end tiers', () => {
    // 指针拖到轨道外仍然落在合法档位，不会产生越界下标。
    expect(effortIndexFromOffset(-500, WIDTH, 3)).toBe(0)
    expect(effortIndexFromOffset(0, WIDTH, 3)).toBe(0)
    expect(effortIndexFromOffset(WIDTH + 500, WIDTH, 3)).toBe(2)
  })

  it('crosses the midpoint exactly halfway between two tiers', () => {
    const points = effortStopPositions(WIDTH, 3)
    const middle = (points[0] + points[1]) / 2
    expect(effortIndexFromOffset(middle - 1, WIDTH, 3)).toBe(0)
    expect(effortIndexFromOffset(middle + 1, WIDTH, 3)).toBe(1)
  })

  it('handles a zero-width track without dividing by zero', () => {
    const points = effortStopPositions(0, 3)
    expect(points.every((point) => Number.isFinite(point))).toBe(true)
    expect(Number.isFinite(effortIndexFromOffset(0, 0, 3))).toBe(true)
    expect(effortIndexFromOffset(0, 0, 3)).toBe(0)
  })

  it('returns no stops when the model opens nothing', () => {
    expect(effortStopPositions(WIDTH, 0)).toEqual([])
  })
})

describe('轨道与滑块的比例', () => {
  it('轨道高写在几何常量里，不能靠 Tailwind h-6（根字号 14px 时只有 21px）', () => {
    expect(EFFORT_TRACK_HEIGHT).toBe(24)
    expect(EFFORT_THUMB_SIZE).toBe(27)
    // 滑块只比轨道高 3px，视觉上是“贴在轨道上的圆片”，不是突起的球。
    expect(EFFORT_THUMB_SIZE - EFFORT_TRACK_HEIGHT).toBe(3)
  })
})
