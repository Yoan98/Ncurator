import { describe, expect, it } from 'vitest'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingIndicator,
  isBrainThinkingOpenInLog
} from '../../../../src/shared/assistantThinkingWait'

describe('shouldShowAssistantThinkingIndicator', () => {
  it('shows when brain thinking is active on run start', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: true
      })
    ).toBe(true)
  })

  it('hides when brain thinking is false or undefined', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: false
      })
    ).toBe(false)

    expect(
      shouldShowAssistantThinkingIndicator({})
    ).toBe(false)
  })

  it('hides when run has finished even if brain thinking flag is true', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: true,
        runFinished: true
      })
    ).toBe(false)
  })

  it('hides when waiting for approval', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: true,
        waitingApproval: true
      })
    ).toBe(false)
  })

  it('hides when final answer is already present', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: true,
        hasFinalAnswer: true
      })
    ).toBe(false)
  })

  it('hides while an LLM retry is running even if brain thinking is still flagged', () => {
    expect(
      shouldShowAssistantThinkingIndicator({
        isBrainThinking: true,
        hasRunningRetry: true
      })
    ).toBe(false)
  })
})

describe('shouldActivityHeaderShimmer', () => {
  it('keeps shimmer until the next thought or other AI content', () => {
    expect(
      shouldActivityHeaderShimmer({
        activityCreatedAt: 2,
        thoughts: [{ createdAt: 1 }],
        hasNextAiContent: false
      })
    ).toBe(true)

    expect(
      shouldActivityHeaderShimmer({
        activityCreatedAt: 2,
        thoughts: [{ createdAt: 1 }, { createdAt: 3 }],
        hasNextAiContent: false
      })
    ).toBe(false)

    expect(
      shouldActivityHeaderShimmer({
        activityCreatedAt: 2,
        thoughts: [{ createdAt: 1 }],
        hasNextAiContent: true
      })
    ).toBe(false)
  })
})

describe('isBrainThinkingOpenInLog', () => {
  it('returns true when thinking_started is open and run is active', () => {
    const records = [
      { entry: { kind: 'annotation', eventType: 'thinking_started' } }
    ]
    expect(isBrainThinkingOpenInLog(records, false)).toBe(true)
  })

  it('returns false after thinking_completed', () => {
    const records = [
      { entry: { kind: 'annotation', eventType: 'thinking_started' } },
      { entry: { kind: 'annotation', eventType: 'thinking_completed' } }
    ]
    expect(isBrainThinkingOpenInLog(records, false)).toBe(false)
  })

  it('returns false when runFinished is true even with unclosed thinking_started', () => {
    const records = [
      { entry: { kind: 'annotation', eventType: 'thinking_started' } }
    ]
    expect(isBrainThinkingOpenInLog(records, true)).toBe(false)
  })
})
