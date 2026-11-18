import { describe, expect, it } from 'vitest'
import {
  nextScrollToLatestVisible,
  SCROLL_TO_LATEST_HIDE_PX,
  SCROLL_TO_LATEST_SHOW_PX
} from '../../../../src/shared/scrollToLatest'

describe('scroll to latest visibility', () => {
  it('shows only after passing the show threshold', () => {
    expect(nextScrollToLatestVisible(false, SCROLL_TO_LATEST_SHOW_PX)).toBe(false)
    expect(nextScrollToLatestVisible(false, SCROLL_TO_LATEST_SHOW_PX + 1)).toBe(true)
  })

  it('keeps showing between the two thresholds', () => {
    expect(nextScrollToLatestVisible(true, SCROLL_TO_LATEST_HIDE_PX + 1)).toBe(true)
    expect(nextScrollToLatestVisible(false, SCROLL_TO_LATEST_HIDE_PX + 1)).toBe(false)
  })

  it('hides again near the bottom', () => {
    expect(nextScrollToLatestVisible(true, SCROLL_TO_LATEST_HIDE_PX)).toBe(false)
    expect(nextScrollToLatestVisible(true, 0)).toBe(false)
  })
})
