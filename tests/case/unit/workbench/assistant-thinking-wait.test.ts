import { describe, expect, it } from 'vitest'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingWait,
  visibleAssistantProcessGroups,
  type AssistantThinkingWaitGroup,
  type AssistantThinkingWaitThought
} from '../../../../src/shared/assistantThinkingWait'

const thinkingGroup = (createdAt = 1): AssistantThinkingWaitGroup => ({
  kind: 'thinking',
  status: 'running',
  sourceEventType: 'thinking',
  createdAt
})

const toolGroup = (
  status: AssistantThinkingWaitGroup['status'] = 'completed',
  createdAt = 2
): AssistantThinkingWaitGroup => ({
  kind: 'skill',
  status,
  sourceEventType: 'assistant_process_group_started',
  createdAt
})

const thought = (createdAt = 3): AssistantThinkingWaitThought => ({ createdAt })

describe('shouldShowAssistantThinkingWait', () => {
  it('shows on cold start before any thought or activity', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [thinkingGroup()],
        processThoughts: []
      })
    ).toBe(true)
  })

  it('shows after a thought even when no thinking process group remains', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [toolGroup('completed', 2)],
        processThoughts: [thought(3)]
      })
    ).toBe(true)
  })

  it('shows again after a thought when waiting before next tools', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [toolGroup('completed', 2), thinkingGroup(4)],
        processThoughts: [thought(3)]
      })
    ).toBe(true)
  })

  it('hides when the latest product is a completed activity', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [thinkingGroup(1), toolGroup('completed', 5)],
        processThoughts: [thought(3)]
      })
    ).toBe(false)
  })

  it('hides while an activity is running', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [thinkingGroup(1), toolGroup('running', 2)],
        processThoughts: []
      })
    ).toBe(false)
  })

  it('hides when brain output is already streaming', () => {
    expect(
      shouldShowAssistantThinkingWait({
        processGroups: [thinkingGroup()],
        processThoughts: [],
        hasVisibleBrainOutput: true
      })
    ).toBe(false)
  })

  it('filters thinking groups from visible process groups when segment forbids it', () => {
    const groups = visibleAssistantProcessGroups({
      processGroups: [toolGroup('completed', 2), thinkingGroup(4)],
      processThoughts: []
    })
    expect(groups.some((group) => group.kind === 'thinking')).toBe(false)
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
