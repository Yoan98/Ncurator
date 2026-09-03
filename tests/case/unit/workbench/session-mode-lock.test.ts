import { describe, expect, it } from 'vitest'
import {
  isWorkbenchModeSwitchAllowed,
  resolveWorkbenchSessionModeLock,
  WORKBENCH_MODE_LOCK_HINTS
} from '../../../../src/shared/workbenchSessionModeLock'

describe('workbench session mode lock', () => {
  it('allows either mode on an empty draft', () => {
    const lock = resolveWorkbenchSessionModeLock({
      hasAiHistory: false,
      hasSearchHistory: false
    })
    expect(lock).toBe('none')
    expect(isWorkbenchModeSwitchAllowed(lock, 'ai')).toBe(true)
    expect(isWorkbenchModeSwitchAllowed(lock, 'search')).toBe(true)
  })

  it('locks search after ai history and ai after search history', () => {
    expect(
      resolveWorkbenchSessionModeLock({
        hasAiHistory: true,
        hasSearchHistory: false
      })
    ).toBe('ai')
    expect(
      isWorkbenchModeSwitchAllowed('ai', 'search')
    ).toBe(false)
    expect(WORKBENCH_MODE_LOCK_HINTS.disableSearch).toContain('不能切换到搜索')

    expect(
      resolveWorkbenchSessionModeLock({
        hasAiHistory: false,
        hasSearchHistory: true
      })
    ).toBe('search')
    expect(isWorkbenchModeSwitchAllowed('search', 'ai')).toBe(false)
    expect(WORKBENCH_MODE_LOCK_HINTS.disableAi).toContain('不能切回 AI')
  })

  it('falls back to current mode when a legacy session mixed both histories', () => {
    expect(
      resolveWorkbenchSessionModeLock({
        hasAiHistory: true,
        hasSearchHistory: true,
        fallbackMode: 'search'
      })
    ).toBe('search')
  })
})
