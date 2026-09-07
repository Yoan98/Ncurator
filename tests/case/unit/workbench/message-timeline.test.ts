import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  buildTimelineNodes,
  collectMessageDayStarts,
  resolveActiveTimelineNodeId,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalYear
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

  it('expands one month into day nodes and keeps sibling months folded', () => {
    const now = atLocalDay(2026, 8, 7)
    const august13 = startOfLocalDay(atLocalDay(2026, 7, 13))
    const august14 = startOfLocalDay(atLocalDay(2026, 7, 14))
    const april13 = startOfLocalDay(atLocalDay(2026, 3, 13))
    const monthStart = startOfLocalMonth(august13)
    const nodes = buildTimelineNodes({
      messageDayStarts: [april13, august13, august14, startOfLocalDay(now)],
      now,
      expansion: { kind: 'month', monthStart }
    })
    expect(nodes.map((node) => ({ level: node.level, role: node.role, label: node.label }))).toEqual([
      { level: 'month', role: 'node', label: '4月' },
      { level: 'month', role: 'segment', label: '8' },
      { level: 'day', role: 'node', label: '8/13' },
      { level: 'day', role: 'node', label: '8/14' },
      { level: 'month', role: 'node', label: '9月' }
    ])
  })

  it('expands one year into months and collapses other ranges', () => {
    const now = atLocalDay(2026, 8, 7)
    const march = startOfLocalDay(atLocalDay(2025, 2, 10))
    const august = startOfLocalDay(atLocalDay(2025, 7, 13))
    const yearStart = startOfLocalYear(march)
    const nodes = buildTimelineNodes({
      messageDayStarts: [march, august, startOfLocalDay(now)],
      now,
      expansion: { kind: 'year', yearStart }
    })
    expect(nodes.map((node) => ({ level: node.level, role: node.role, label: node.label }))).toEqual([
      { level: 'year', role: 'segment', label: '2025' },
      { level: 'month', role: 'node', label: '25/3' },
      { level: 'month', role: 'node', label: '25/8' },
      { level: 'month', role: 'node', label: '9月' }
    ])
  })

  it('resolves active node preferring day over containing month', () => {
    const now = atLocalDay(2026, 8, 7)
    const august13 = startOfLocalDay(atLocalDay(2026, 7, 13))
    const nodes = buildTimelineNodes({
      messageDayStarts: [august13, startOfLocalDay(now)],
      now,
      expansion: { kind: 'month', monthStart: startOfLocalMonth(august13) }
    })
    expect(
      resolveActiveTimelineNodeId({
        nodes,
        activeDayStart: august13
      })
    ).toBe(`day-${august13}`)
  })

  it('collectMessageDayStarts dedupes and sorts', () => {
    const a = startOfLocalDay(atLocalDay(2026, 8, 1, 8))
    const b = startOfLocalDay(atLocalDay(2026, 8, 1, 20))
    const c = startOfLocalDay(atLocalDay(2026, 8, 2, 9))
    expect(collectMessageDayStarts([c, a, b])).toEqual([a, c])
  })
})
