import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  TIMELINE_COMPOSER_MAX_PX,
  TIMELINE_FULL_WIDTH_PX,
  buildTimelineNodes,
  collectMessageDayStarts,
  collectSelectableDaysForNode,
  resolveActiveTimelineNodeId,
  resolveTimelineLeftPx,
  shouldUseCompactTimeline,
  startOfLocalDay,
  startOfLocalMonth
} from '../../../../src/shared/workbench/messageTimeline'

const atLocalDay = (year: number, monthIndex: number, day: number, hour = 12): number => {
  const date = new Date(year, monthIndex, day, hour, 0, 0, 0)
  return date.getTime()
}

describe('messageTimeline', () => {
  it('only creates nodes for days that have messages', () => {
    const now = atLocalDay(2026, 8, 7)
    const nodes = buildTimelineNodes({
      messageDayStarts: [startOfLocalDay(now), startOfLocalDay(now - DAY_MS)],
      now
    })
    expect(nodes.map((node) => node.label)).toEqual(['昨天', '今天'])
    expect(nodes.every((node) => node.level === 'day')).toBe(true)
  })

  it('folds older same-year days into months outside the recent week', () => {
    const now = atLocalDay(2026, 8, 7)
    const august13 = startOfLocalDay(atLocalDay(2026, 7, 13))
    const april13 = startOfLocalDay(atLocalDay(2026, 3, 13))
    const nodes = buildTimelineNodes({
      messageDayStarts: [april13, august13, startOfLocalDay(now)],
      now
    })
    expect(nodes.map((node) => ({ level: node.level, label: node.label }))).toEqual([
      { level: 'month', label: '4月' },
      { level: 'month', label: '8月' },
      { level: 'day', label: '今天' }
    ])
  })

  it('folds prior years into year nodes', () => {
    const now = atLocalDay(2026, 8, 7)
    const priorYear = startOfLocalDay(atLocalDay(2025, 5, 1))
    const nodes = buildTimelineNodes({
      messageDayStarts: [priorYear, startOfLocalDay(now)],
      now
    })
    expect(nodes.map((node) => ({ level: node.level, label: node.label }))).toEqual([
      { level: 'year', label: '2025' },
      { level: 'day', label: '今天' }
    ])
  })

  it('keeps month folded and exposes selectable days for picker', () => {
    const now = atLocalDay(2026, 8, 7)
    const august13 = startOfLocalDay(atLocalDay(2026, 7, 13))
    const august14 = startOfLocalDay(atLocalDay(2026, 7, 14))
    const april13 = startOfLocalDay(atLocalDay(2026, 3, 13))
    const days = [april13, august13, august14, startOfLocalDay(now)]
    const nodes = buildTimelineNodes({ messageDayStarts: days, now })
    const august = nodes.find((node) => node.id === `month-${startOfLocalMonth(august13)}`)
    expect(august).toBeTruthy()
    expect(collectSelectableDaysForNode(august!, days)).toEqual([august13, august14])
    expect(nodes.map((node) => node.level)).toEqual(['month', 'month', 'day'])
  })

  it('resolves active node preferring day over containing month', () => {
    const now = atLocalDay(2026, 8, 7)
    const august13 = startOfLocalDay(atLocalDay(2026, 7, 13))
    const nodes = buildTimelineNodes({
      messageDayStarts: [august13, startOfLocalDay(now)],
      now
    })
    expect(
      resolveActiveTimelineNodeId({
        nodes,
        activeDayStart: august13
      })
    ).toBe(`month-${startOfLocalMonth(august13)}`)
    expect(
      resolveActiveTimelineNodeId({
        nodes,
        activeDayStart: startOfLocalDay(now)
      })
    ).toBe(`day-${startOfLocalDay(now)}`)
  })

  it('collectMessageDayStarts dedupes and sorts', () => {
    const a = startOfLocalDay(atLocalDay(2026, 8, 1, 8))
    const b = startOfLocalDay(atLocalDay(2026, 8, 1, 20))
    const c = startOfLocalDay(atLocalDay(2026, 8, 2, 9))
    expect(collectMessageDayStarts([c, a, b])).toEqual([a, c])
  })

  it('enters compact before full timeline labels overlap the composer gutter', () => {
    // 旧阈值「gutter < 72」在 host≈920 时仍显示完整文案，但轴 left+56 已越过 Composer 左缘。
    const overlappingHostWidth = 920
    const leftGutter = Math.round((overlappingHostWidth - TIMELINE_COMPOSER_MAX_PX) / 2)
    expect(leftGutter).toBeGreaterThanOrEqual(72)
    expect(
      resolveTimelineLeftPx(overlappingHostWidth) + TIMELINE_FULL_WIDTH_PX
    ).toBeGreaterThan(leftGutter)
    expect(
      shouldUseCompactTimeline({ hostWidthPx: overlappingHostWidth, leftGutterPx: leftGutter })
    ).toBe(true)

    const roomyHostWidth = 1100
    const roomyGutter = Math.round((roomyHostWidth - TIMELINE_COMPOSER_MAX_PX) / 2)
    expect(
      shouldUseCompactTimeline({ hostWidthPx: roomyHostWidth, leftGutterPx: roomyGutter })
    ).toBe(false)
  })
})
