import { describe, expect, it } from 'vitest'
import {
  emitCompactionCompleted,
  emitLearningCompleted,
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
      toolName: 'docx_outline',
      args: { sourcePath: '/tmp/report.docx' }
    })
    emitToolProcessStarted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'tool-b',
      toolName: 'docx_outline',
      args: { sourcePath: '/tmp/notes.docx' }
    })
    emitToolProcessCompleted({
      sendEvent,
      runId: 'run-1',
      toolCallId: 'tool-a',
      toolName: 'docx_outline',
      ok: true
    })

    const groupEvents = events.filter(
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

  it('does not restart thinking after learning or compaction completes', () => {
    const events: AiRunEvent[] = []
    const sendEvent = (event: AiRunEvent): void => {
      events.push(event)
    }

    emitLearningCompleted({
      sendEvent,
      runId: 'run-1',
      skillId: 'docx-read'
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
})
