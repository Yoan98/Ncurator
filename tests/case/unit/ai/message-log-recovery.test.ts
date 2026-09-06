import { describe, expect, it } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import {
  projectMessageLogRecords,
  repairInterruptedToolCalls
} from '../../../../src/main/services/ai/human/memory/transcript'

const user = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  context: {
    selectedReferences: [],
    attachments: []
  }
})

const records = (entries: Array<{ runId: string; entry: ChatMessageLogEntry }>) =>
  entries.map(
    ({ runId, entry }, index): ChatMessageLogRecord => ({
      id: `log-${index + 1}`,
      partnerId: 'partner-1',
      runId,
      seq: index + 1,
      entry,
      createdAt: index + 1
    })
  )

describe('ai human message-log recovery', () => {
  it('projects one checkpoint summary plus only records after its covered sequence', () => {
    const projection = projectMessageLogRecords(
      records([
        { runId: 'run-1', entry: user('old secret that must be compacted') },
        {
          runId: 'run-1',
          entry: { kind: 'assistant', content: 'old answer', toolCalls: [] }
        },
        {
          runId: 'run-2',
          entry: {
            kind: 'annotation',
            eventType: 'compaction_checkpoint',
            payload: {
              compactBlockId: 'checkpoint-1',
              summary: 'compressed history',
              coveredThroughSeq: 2,
              sourceMessageCount: 2
            }
          }
        },
        { runId: 'run-2', entry: user('continue from summary') },
        {
          runId: 'run-2',
          entry: { kind: 'assistant', content: 'new answer', toolCalls: [] }
        }
      ])
    )

    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(projection.checkpoint?.summary).toBe('compressed history')
    expect(text).not.toContain('compressed history')
    expect(projection.messages.every((message) => message.getType() !== 'human')).toBe(true)
    expect(text).not.toContain('continue from summary')
    expect(text).not.toContain('<historical_user_turn>')
    expect(text).toContain('new answer')
    expect(text).not.toContain('old secret that must be compacted')
  })

  it('keeps the latest unfinished plan and clears it after normal finalization', () => {
    const unfinished = records([
      { runId: 'run-1', entry: user('do work') },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'plan_updated',
          payload: { plan: [{ title: 'inspect files', status: 'todo' }] }
        }
      }
    ])
    expect(projectMessageLogRecords(unfinished).plan).toEqual([
      { title: 'inspect files', status: 'todo' }
    ])

    const finalized: ChatMessageLogRecord[] = [
      ...unfinished,
      {
        id: 'log-3',
        partnerId: 'partner-1',
        runId: 'run-1',
        seq: 3,
        entry: { kind: 'annotation', eventType: 'finalizing_started', payload: {} },
        createdAt: 3
      }
    ]
    expect(projectMessageLogRecords(finalized).plan).toEqual([])
  })

  it('drops history before the latest context_cleared cut, including older checkpoints', () => {
    const projection = projectMessageLogRecords(
      records([
        { runId: 'run-1', entry: user('secret before clear') },
        {
          runId: 'run-1',
          entry: { kind: 'assistant', content: 'old answer', toolCalls: [] }
        },
        {
          runId: 'run-1',
          entry: {
            kind: 'annotation',
            eventType: 'compaction_checkpoint',
            payload: {
              compactBlockId: 'checkpoint-old',
              summary: 'must not enter next brain',
              coveredThroughSeq: 2,
              sourceMessageCount: 2
            }
          }
        },
        {
          runId: 'run-2',
          entry: { kind: 'annotation', eventType: 'context_cleared', payload: {} }
        },
        { runId: 'run-3', entry: user('new request after clear') },
        {
          runId: 'run-3',
          entry: { kind: 'assistant', content: 'fresh answer', toolCalls: [] }
        }
      ])
    )

    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(projection.checkpoint).toBeUndefined()
    expect(text).not.toContain('secret before clear')
    expect(text).not.toContain('old answer')
    expect(text).not.toContain('must not enter next brain')
    expect(text).toContain('fresh answer')
  })

  it('repairs a dangling tool call with the same tool_call_id', () => {
    const repaired = repairInterruptedToolCalls([
      new AIMessage({
        content: 'calling tool',
        tool_calls: [{ id: 'call-1', name: 'read_file', args: {}, type: 'tool_call' }]
      })
    ])
    expect(repaired).toHaveLength(2)
    expect(repaired[1]).toBeInstanceOf(ToolMessage)
    expect((repaired[1] as ToolMessage).tool_call_id).toBe('call-1')
    expect(String(repaired[1].content)).toContain('interrupted')
  })
})
