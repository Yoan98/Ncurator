import { describe, expect, it } from 'vitest'
import {
  collectUserMessageTimeIds,
  formatUserMessageTimeLabel,
  shouldShowUserMessageTime,
  USER_MESSAGE_TIME_GAP_MS
} from '../../../../src/shared/workbench/messageTimeLabel'

const at = (year: number, monthIndex: number, day: number, hour: number, minute = 0): number =>
  new Date(year, monthIndex, day, hour, minute, 0, 0).getTime()

describe('messageTimeLabel', () => {
  it('shows time on the first user message', () => {
    expect(shouldShowUserMessageTime(null, at(2026, 8, 8, 10))).toBe(true)
  })

  it('hides time when two user messages are within 30 minutes on the same day', () => {
    const first = at(2026, 8, 8, 10, 0)
    expect(shouldShowUserMessageTime(first, first + USER_MESSAGE_TIME_GAP_MS - 1)).toBe(false)
  })

  it('shows time when two user messages are 30 minutes or more apart', () => {
    const first = at(2026, 8, 8, 10, 0)
    expect(shouldShowUserMessageTime(first, first + USER_MESSAGE_TIME_GAP_MS)).toBe(true)
  })

  it('shows time when two user messages cross a local day even if under 30 minutes', () => {
    const late = at(2026, 8, 8, 23, 58)
    const earlyNext = at(2026, 8, 9, 0, 2)
    expect(earlyNext - late).toBeLessThan(USER_MESSAGE_TIME_GAP_MS)
    expect(shouldShowUserMessageTime(late, earlyNext)).toBe(true)
  })

  it('ignores assistant messages when collecting ids', () => {
    const first = at(2026, 8, 8, 10, 0)
    const ids = collectUserMessageTimeIds([
      { id: 'u1', role: 'user', timestamp: first },
      { id: 'a1', role: 'assistant', timestamp: first + 60_000 },
      { id: 'u2', role: 'user', timestamp: first + 5 * 60_000 },
      { id: 'u3', role: 'user', timestamp: first + 5 * 60_000 + USER_MESSAGE_TIME_GAP_MS }
    ])
    expect([...ids]).toEqual(['u1', 'u3'])
  })

  it('formats today / yesterday / weekday / date labels', () => {
    const now = at(2026, 8, 8, 18, 0)
    expect(formatUserMessageTimeLabel(at(2026, 8, 8, 16, 45), now)).toBe('16:45')
    expect(formatUserMessageTimeLabel(at(2026, 8, 7, 16, 45), now)).toBe('昨天 16:45')
    expect(formatUserMessageTimeLabel(at(2026, 8, 6, 16, 45), now)).toMatch(/星期.+16:45/)
    expect(formatUserMessageTimeLabel(at(2026, 2, 15, 16, 45), now)).toBe('2026/3/15 16:45')
  })
})
