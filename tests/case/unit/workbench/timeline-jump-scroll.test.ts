import { describe, expect, it } from 'vitest'
import {
  measureTimelineJumpSpacerPx,
  measureTimelinePinScrollTop
} from '../../../../src/shared/workbench/messageTimeline'

describe('timelineJumpScroll', () => {
  it('adds just enough spacer when the target cannot pin without it', () => {
    expect(
      measureTimelineJumpSpacerPx({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 800,
        targetTop: 600,
        scrollerTop: 0,
        currentSpacerPx: 0
      })
    ).toBe(400)
  })

  it('needs no spacer when trailing content already fills the viewport', () => {
    expect(
      measureTimelineJumpSpacerPx({
        scrollTop: 0,
        scrollHeight: 4000,
        clientHeight: 800,
        targetTop: 120,
        scrollerTop: 0,
        currentSpacerPx: 0
      })
    ).toBe(0)
  })

  it('replaces an existing spacer instead of stacking it', () => {
    expect(
      measureTimelineJumpSpacerPx({
        scrollTop: 600,
        scrollHeight: 1400,
        clientHeight: 800,
        targetTop: 0,
        scrollerTop: 0,
        currentSpacerPx: 400
      })
    ).toBe(400)
  })

  it('pins using the current viewport offset', () => {
    expect(
      measureTimelinePinScrollTop({
        scrollTop: 240,
        targetTop: 80,
        scrollerTop: 40
      })
    ).toBe(280)
  })

  it('needs more spacer to pin the latest day than an earlier day', () => {
    const latestDay = measureTimelineJumpSpacerPx({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 800,
      targetTop: 600,
      scrollerTop: 0,
      currentSpacerPx: 0
    })
    const earlierDay = measureTimelineJumpSpacerPx({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 800,
      targetTop: 120,
      scrollerTop: 0,
      currentSpacerPx: 0
    })
    expect(latestDay).toBeGreaterThan(earlierDay)
  })
})
