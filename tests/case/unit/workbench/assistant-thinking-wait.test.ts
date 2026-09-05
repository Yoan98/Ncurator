import { describe, expect, it } from 'vitest'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingIndicator
} from '../../../../src/shared/assistantThinkingWait'
import { projectProcessGroups } from '../../../../src/renderer/src/components/workbench/messageLogProjection'
import type { ChatMessageLogRecord } from '../../../../src/shared/types'

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

describe('projectProcessGroups', () => {
  const buildRecord = (
    seq: number,
    entry: ChatMessageLogRecord['entry']
  ): Pick<ChatMessageLogRecord, 'entry' | 'seq' | 'createdAt'> => ({
    seq,
    entry,
    createdAt: seq * 1000
  })

  it('projects isBrainThinking as true when thinking_started is open and run is active', () => {
    const records = [
      buildRecord(1, { kind: 'annotation', eventType: 'thinking_started', payload: {} })
    ]
    const projected = projectProcessGroups({
      runId: 'run-1',
      records,
      runFinished: false
    })
    expect(projected.isBrainThinking).toBe(true)
    expect(projected.processGroups).toEqual([])
  })

  it('projects isBrainThinking as false after thinking_completed', () => {
    const records = [
      buildRecord(1, { kind: 'annotation', eventType: 'thinking_started', payload: {} }),
      buildRecord(2, { kind: 'annotation', eventType: 'thinking_completed', payload: {} })
    ]
    const projected = projectProcessGroups({
      runId: 'run-1',
      records,
      runFinished: false
    })
    expect(projected.isBrainThinking).toBe(false)
  })

  it('projects isBrainThinking as false when runFinished is true even with unclosed thinking_started', () => {
    const records = [
      buildRecord(1, { kind: 'annotation', eventType: 'thinking_started', payload: {} })
    ]
    const projected = projectProcessGroups({
      runId: 'run-1',
      records,
      runFinished: true
    })
    expect(projected.isBrainThinking).toBe(false)
  })

  it('projects thoughts cleanly without fake thinking groups in processGroups', () => {
    const records = [
      buildRecord(1, { kind: 'annotation', eventType: 'thinking_started', payload: {} }),
      buildRecord(2, {
        kind: 'assistant',
        content: '我正在分析代码并准备调用工具',
        toolCalls: [{ id: 'call-1', name: 'text_file_read', args: { path: 'a.txt' } }]
      }),
      buildRecord(3, { kind: 'annotation', eventType: 'thinking_completed', payload: {} }),
      buildRecord(4, { kind: 'tool', toolCallId: 'call-1', toolName: 'text_file_read', ok: true, output: 'ok' })
    ]
    const projected = projectProcessGroups({
      runId: 'run-1',
      records,
      runFinished: false
    })
    expect(projected.isBrainThinking).toBe(false)
    expect(projected.processThoughts).toHaveLength(1)
    expect(projected.processThoughts[0].text).toBe('我正在分析代码并准备调用工具')
    expect(projected.processGroups.some((g) => g.kind === 'thinking')).toBe(false)
    expect(projected.processGroups).toHaveLength(1)
    expect(projected.processGroups[0].kind).toBe('skill')
  })
})
