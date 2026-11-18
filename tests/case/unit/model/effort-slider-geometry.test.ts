import { describe, expect, it } from 'vitest'
import {
  EFFORT_THUMB_RADIUS,
  EFFORT_THUMB_SIZE,
  EFFORT_TRACK_HEIGHT,
  effortClampToTrack,
  effortFillWidth,
  effortIndexFromOffset,
  effortPaletteFromAvatarColor,
  EFFORT_TRACK_RADIUS,
  effortStopPositions
} from '../../../../src/shared/effortSliderGeometry'

const WIDTH = 262

describe('effort slider geometry', () => {
  it('insets the first and last stop by exactly the thumb radius', () => {
    const points = effortStopPositions(WIDTH, 3)
    // 内缩量 = 滑块半径：形象中心正对轨道圆头圆心，形象整个留在轨道内。
    expect(points[0]).toBe(EFFORT_THUMB_RADIUS)
    expect(points[2]).toBe(WIDTH - EFFORT_THUMB_RADIUS)
    expect(points[1]).toBe((points[0] + points[2]) / 2)
  })

  it('draws the fill from the track start, and all the way to its end at the last tier', () => {
    const points = effortStopPositions(WIDTH, 3)
    const trackStart = EFFORT_TRACK_RADIUS
    const trackWidth = WIDTH - EFFORT_TRACK_RADIUS * 2
    // 首档：填充只到首档中心，长度 = 轨道端头半径，整段都在形象底下，视觉上全灰。
    expect(effortFillWidth(points[0])).toBe(EFFORT_TRACK_RADIUS)
    // 中间档：从轨道条左端画到形象中心，末端被形象盖住。
    expect(effortFillWidth(points[1])).toBe(points[1] - trackStart)
    // 末档不传容器宽时仍只画到形象中心。
    expect(effortFillWidth(points[2])).toBe(points[2] - trackStart)
    // 末档 + 传容器宽：铺满整条轨道条，右侧不留浅色尾巴。
    expect(effortFillWidth(points[2], WIDTH, true)).toBe(trackWidth)
  })

  it('keeps the thumb centred on a stop for every index', () => {
    // 组件把形象放在 points[index] 上并左移半径，所以圆心恒等于点位。
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
    // 滑块直接就是伙伴形象本身（不再垫白底），48px 是轨道的 2 倍高，形象足够醒目。
    expect(EFFORT_THUMB_SIZE).toBe(48)
    expect(EFFORT_THUMB_SIZE - EFFORT_TRACK_HEIGHT).toBe(24)
    // 半径同时是点位内缩量，必须是整数像素，否则末档会与轨道末端错开半像素。
    expect(EFFORT_THUMB_RADIUS).toBe(24)
  })
})

describe('drag follow and snap', () => {
  it('clamps the pointer inside the track so the thumb never leaves the rounded ends', () => {
    const width = 264
    // 左端越界 → 贴到首档点位（= 半径）
    expect(effortClampToTrack(-50, width)).toBe(EFFORT_THUMB_RADIUS)
    // 右端越界 → 贴到末档点位
    expect(effortClampToTrack(width + 50, width)).toBe(width - EFFORT_THUMB_RADIUS)
    // 中间原样保留，保证拖拽严格跟手、不被量化到档位
    const middle = width / 2
    expect(effortClampToTrack(middle, width)).toBe(middle)
  })

  it('keeps every intermediate position between two stops (no quantisation while dragging)', () => {
    const width = 264
    const points = effortStopPositions(width, 3)
    const between = (points[0] + points[1]) / 2
    // 跟手位置不等于任何点位，但仍被原样保留
    expect(effortClampToTrack(between, width)).toBe(between)
    expect(points).not.toContain(between)
  })

  it('snaps to the nearest stop on release, including exactly at the midpoint', () => {
    const width = 264
    const points = effortStopPositions(width, 3)
    const mid = (points[0] + points[1]) / 2
    // 中点两侧各自吸附到更近的一档
    expect(effortIndexFromOffset(mid - 4, width, 3)).toBe(0)
    expect(effortIndexFromOffset(mid + 4, width, 3)).toBe(1)
    // 中点本身取靠后的一档（Math.round 的固有行为，保证不抖动）
    expect(effortIndexFromOffset(mid, width, 3)).toBe(1)
    // 贴着点位时必然吸附到自己
    for (const [index, x] of points.entries()) {
      expect(effortIndexFromOffset(x, width, 3)).toBe(index)
    }
  })

  it('maps the release position back to the same stop the thumb was clamped to', () => {
    const width = 264
    expect(effortIndexFromOffset(effortClampToTrack(-9, width), width, 3)).toBe(0)
    expect(effortIndexFromOffset(effortClampToTrack(width + 9, width), width, 3)).toBe(2)
  })
})

describe('fill never pokes out from behind the thumb', () => {
  it('ends the fill exactly at the thumb centre so the rounded cap stays covered', () => {
    const width = 264
    const trackStart = EFFORT_TRACK_RADIUS
    for (const count of [2, 3, 4, 6]) {
      const points = effortStopPositions(width, count)
      for (const [index, x] of points.entries()) {
        // 填充止于形象中心（填充从轨道条左端起算），末端圆头被形象盖住。
        expect(effortFillWidth(x), `count=${count} index=${index}`).toBe(x - trackStart)
      }
    }
  })

  it('leaves no grey tail on the right at the last tier', () => {
    const width = 264
    for (const count of [2, 3, 4, 6]) {
      const points = effortStopPositions(width, count)
      // 首档：填充只在形象底下，视觉上轨道整体露出。
      expect(effortFillWidth(points[0], width, false)).toBe(EFFORT_TRACK_RADIUS)
      // 末档：填充必须铺满整条轨道条（= 容器宽 - 两端缩进），
      // 否则右侧会剩半圆形浅色轨道，看起来就是一条缝。
      expect(effortFillWidth(points[count - 1], width, true)).toBe(
        width - EFFORT_TRACK_RADIUS * 2
      )
    }
  })
})

describe('effortPaletteFromAvatarColor', () => {
  const ALL_COLORS = [
    '#1F1F1F', '#8B5A2B', '#C44536', '#E07A3D',
    '#E2B714', '#3D8B5A', '#2A9D8F', '#3B6FBA',
    '#7B5EA7', '#D46A92', '#C8C6C2', '#5C5B58'
  ]

  /** 从 hsl() 字符串取明度，用来验证「不同主色的明度落在同一区间」。 */
  const lightnessOf = (color: string): number => Number(color.match(/(\d+)%\)$/)?.[1] ?? NaN)

  it('keeps every avatar colour in one lightness band so the UI stays coherent', () => {
    for (const hex of ALL_COLORS) {
      const { fill } = effortPaletteFromAvatarColor(hex)
      expect(fill, hex).toMatch(/^hsl\(/)
      const lightness = lightnessOf(fill)
      // 填充色明度收敛在 46%~58%：够深压住白底，又不会黑成一条。
      expect(lightness, `${hex} → ${fill}`).toBeGreaterThanOrEqual(46)
      expect(lightness, `${hex} → ${fill}`).toBeLessThanOrEqual(58)
    }
  })

  it('gives each avatar colour its own hue instead of a single shared colour', () => {
    const hues = new Set(
      ALL_COLORS.map((hex) => effortPaletteFromAvatarColor(hex).fill.match(/^hsl\((\d+)/)?.[1])
    )
    // 至少要有明显多种色相，否则等于所有人共用一个颜色。
    expect(hues.size).toBeGreaterThanOrEqual(8)
  })

  it('keeps the track much lighter than the fill so the two never blend', () => {
    for (const hex of ALL_COLORS) {
      const { fill, track } = effortPaletteFromAvatarColor(hex)
      expect(lightnessOf(track), hex).toBeGreaterThan(lightnessOf(fill) + 25)
    }
  })

  it('stays near-neutral for greys instead of inventing a colour', () => {
    // 近灰的主色饱和度极低，派生色不该突然变成彩色。
    for (const hex of ['#1F1F1F', '#C8C6C2', '#5C5B58']) {
      const saturation = Number(effortPaletteFromAvatarColor(hex).fill.match(/(\d+)% \d+%\)$/)?.[1] ?? NaN)
      expect(saturation, hex).toBeLessThanOrEqual(8)
    }
  })
})

describe('fill never runs ahead of the thumb while dragging', () => {
  const width = 252
  const trackStart = EFFORT_TRACK_RADIUS
  const trackWidth = width - EFFORT_TRACK_RADIUS * 2

  /** 与组件一致：只有形象真的落在末档位置上才铺满整条轨道。 */
  const fillAt = (x: number, lastStop: number): number =>
    effortFillWidth(x, width, x >= lastStop - 0.5)

  it('keeps the fill ending at the thumb for every in-between drag position', () => {
    const points = effortStopPositions(width, 3)
    const first = points[0]
    const last = points[points.length - 1]
    // 逐像素扫过整段可拖动区间，填充右缘任何时刻都不得超过形象右缘。
    for (let x = first; x <= last; x += 1) {
      const fillRight = trackStart + fillAt(x, last)
      const thumbRight = x + EFFORT_THUMB_RADIUS
      expect(fillRight, `x=${x}`).toBeLessThanOrEqual(thumbRight + 1e-9)
    }
  })

  it('does not snap the fill to full width just because the nearest tier is the last one', () => {
    const points = effortStopPositions(width, 3)
    const last = points[points.length - 1]
    // 形象还在半路、但最近档位已经算成末档：填充仍只画到形象中心。
    const halfway = last - 40
    expect(effortIndexFromOffset(halfway, width, 3)).toBe(2)
    expect(fillAt(halfway, last)).toBe(halfway - trackStart)
    // 真正到达末档才铺满轨道条。
    expect(fillAt(last, last)).toBe(trackWidth)
  })
})
