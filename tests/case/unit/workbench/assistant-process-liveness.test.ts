import { describe, expect, it } from 'vitest'
import { reduceAssistantProcessGroups } from '../../../harness/core/assistantProcessGroups'
import {
  isAssistantActivityToolGroup,
  isAssistantRunAlive,
  isBrainThinkingOpenInLog,
  resolveAssistantLiveTailOwner,
  shouldActivityHeaderShimmer
} from '../../../../src/shared/assistantProcessLiveness'

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

  it('stops while waiting for the user', () => {
    expect(
      shouldActivityHeaderShimmer({
        activityCreatedAt: 2,
        thoughts: [{ createdAt: 1 }],
        hasNextAiContent: false,
        waitingForUser: true
      })
    ).toBe(false)
  })
})

describe('isAssistantRunAlive', () => {
  it('is alive while the run is still producing', () => {
    expect(isAssistantRunAlive({ status: 'running' })).toBe(true)
  })

  it.each([
    ['finished', { status: 'completed' as const, runFinished: true }],
    ['failed', { status: 'failed' as const, runFinished: true }],
    ['cancelled', { status: 'cancelled' as const, runFinished: true }],
    ['waiting for approval', { status: 'running' as const, waitingApproval: true }],
    ['waiting for answer', { status: 'running' as const, waitingInteraction: true }]
  ])('stops when %s', (_label, input) => {
    expect(isAssistantRunAlive(input)).toBe(false)
  })
})

describe('resolveAssistantLiveTailOwner', () => {
  const base = {
    runAlive: true,
    hasFinalAnswer: false,
    hasStreamingThought: false
  }

  it('stops everything once the run is no longer alive', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        runAlive: false,
        lastEntry: { kind: 'decision' }
      })
    ).toBe('none')
  })

  it('puts the dot on the final answer first', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        hasFinalAnswer: true,
        lastEntry: { kind: 'decision' }
      })
    ).toBe('answer')
  })

  it('puts the dot on the streaming thought, not on the older thought row', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        hasStreamingThought: true,
        lastEntry: { kind: 'decision' }
      })
    ).toBe('thought')
  })

  it('keeps the dot on the last finalized thought while the run waits for the next step', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        lastEntry: { kind: 'decision' }
      })
    ).toBe('thought')
  })

  it('leaves the Activity header to its own shimmer', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        lastEntry: { kind: 'activity' }
      })
    ).toBe('activity')
  })

  it('leaves self-animated rows alone', () => {
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        lastEntry: { kind: 'group', selfAnimated: true }
      })
    ).toBe('none')
  })

  it('falls back to the placeholder dot when nothing can host it', () => {
    expect(resolveAssistantLiveTailOwner(base)).toBe('placeholder')
    expect(
      resolveAssistantLiveTailOwner({
        ...base,
        lastEntry: { kind: 'group', selfAnimated: false }
      })
    ).toBe('placeholder')
  })
})

describe('isBrainThinkingOpenInLog', () => {
  it('returns true when thinking_started is open and run is active', () => {
    const records = [{ entry: { kind: 'annotation', eventType: 'thinking_started' } }]
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
    const records = [{ entry: { kind: 'annotation', eventType: 'thinking_started' } }]
    expect(isBrainThinkingOpenInLog(records, true)).toBe(false)
  })
})

describe('activity grouping after toolset naming', () => {
  it.each(['load_skill', 'load_toolset', 'file_read'])(
    'groups production %s events into Activity',
    (toolName) => {
      const groups = reduceAssistantProcessGroups([], {
        type: 'assistant_process_group_started',
        runId: 'run-activity',
        groupId: 'group-tool',
        kind: 'toolset',
        display: { kind: 'tool', toolName, input: {} },
        createdAt: 1
      })
      expect(groups).toHaveLength(1)
      expect(isAssistantActivityToolGroup(groups[0])).toBe(true)
      expect(isAssistantActivityToolGroup({ ...groups[0], sourceEventType: 'thinking' })).toBe(
        false
      )
    }
  )
})
