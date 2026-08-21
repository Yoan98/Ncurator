import { describe, expect, it } from 'vitest'
import { computeNextRunAt } from '../../../src/main/services/scheduler/ScheduledTaskService'

const localAt = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): number => new Date(year, month, day, hours, minutes).getTime()

describe('computeNextRunAt', () => {
  it('returns today slot for a daily task when the time is still ahead', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'daily', timeOfDay: '09:00', weekday: null }, after)).toBe(
      localAt(2026, 7, 20, 9, 0)
    )
  })

  it('rolls to tomorrow for a daily task when the time already passed', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'daily', timeOfDay: '07:00', weekday: null }, after)).toBe(
      localAt(2026, 7, 21, 7, 0)
    )
  })

  it('returns later today for a weekly task on the same weekday', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 4 }, after)).toBe(
      localAt(2026, 7, 20, 9, 0)
    )
  })

  it('rolls to next week for a weekly task whose time already passed', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '07:00', weekday: 4 }, after)).toBe(
      localAt(2026, 7, 27, 7, 0)
    )
  })

  it('returns a later weekday within the same week', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 5 }, after)).toBe(
      localAt(2026, 7, 21, 9, 0)
    )
  })

  it('wraps to the following week for an earlier weekday', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 2 }, after)).toBe(
      localAt(2026, 7, 25, 9, 0)
    )
  })

  it('returns null for an invalid time of day', () => {
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '25:00', weekday: null }, Date.now())
    ).toBeNull()
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '9', weekday: null }, Date.now())
    ).toBeNull()
  })

  it('returns null for a weekly task without a valid weekday', () => {
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: null }, Date.now())
    ).toBeNull()
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 7 }, Date.now())
    ).toBeNull()
  })
})
