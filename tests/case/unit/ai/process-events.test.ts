import { describe, expect, it } from 'vitest'
import {
  emitCompactionCompleted,
  emitLlmRetryProcessStarted,
  emitToolProcessCompleted,
  emitToolProcessStarted
} from '../../../../src/main/services/ai/events/processEvents'
import type { AiRunEvent } from '../../../../src/shared/types'

describe('ai process events', () => {
  it('uses tool call identity for process group ids so repeated skills stay separate', () => {
    const events: AiRunEvent[] = []
    const sendEvent = (event: AiRunEvent): void => {
      events.push(event)
    }

    emitToolProcessStarted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'tool-a',
      toolName: 'docx_read_outline',
      args: { sourcePath: '/tmp/report.docx' }
    })
    emitToolProcessStarted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'tool-b',
      toolName: 'docx_read_outline',
      args: { sourcePath: '/tmp/notes.docx' }
    })
    emitToolProcessCompleted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'tool-a',
      toolName: 'docx_read_outline',
      ok: true
    })

    const groupEvents = events
      .filter(
        (event) =>
          event.type === 'assistant_process_group_started' ||
          event.type === 'assistant_process_group_completed'
      )
      .filter((event) => event.groupId.startsWith('run-1:tool:'))

    expect(groupEvents.map((event) => event.groupId)).toEqual([
      'run-1:tool:tool-a',
      'run-1:tool:tool-b',
      'run-1:tool:tool-a'
    ])
  })

  it('does not restart thinking after tool or compaction completes', () => {
    const events: AiRunEvent[] = []
    const sendEvent = (event: AiRunEvent): void => {
      events.push(event)
    }

    emitToolProcessCompleted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'learn-1',
      toolName: 'learn_skill',
      ok: true
    })
    emitCompactionCompleted({
      sendEvent,
      runId: 'run-1'
    })

    expect(
      events.some(
        (event) =>
          event.type === 'assistant_process_group_started' && event.display.kind === 'thinking'
      )
    ).toBe(false)
  })

  it('reuses one run-scoped retry group id across attempts and later LLM calls', () => {
    const events: AiRunEvent[] = []
    const sendEvent = (event: AiRunEvent): void => {
      events.push(event)
    }

    emitLlmRetryProcessStarted({
      sendEvent,
      runId: 'run-1',
      callId: 'call-a',
      attempt: 1,
      maxAttempts: 5,
      message: '429'
    })
    emitLlmRetryProcessStarted({
      sendEvent,
      runId: 'run-1',
      callId: 'call-a',
      attempt: 2,
      maxAttempts: 5,
      message: '429'
    })
    emitLlmRetryProcessStarted({
      sendEvent,
      runId: 'run-1',
      callId: 'call-b',
      attempt: 1,
      maxAttempts: 5,
      message: '429'
    })

    expect(
      events
        .filter((event) => event.type === 'assistant_process_group_started')
        .map((event) => event.groupId)
    ).toEqual(['run-1:llm-retry', 'run-1:llm-retry', 'run-1:llm-retry'])
  })
})
