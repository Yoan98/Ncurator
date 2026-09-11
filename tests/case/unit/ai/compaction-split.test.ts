import { describe, expect, it } from 'vitest'
import type {
  ChatMessageImageRef,
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import {
  hasCompressibleCompactionHistory,
  splitLogForCompactionTail
} from '../../../../src/main/services/ai/human/memory/compactionSplit'
import { messagesFromLogEntries } from '../../../../src/main/services/ai/human/memory/conversationLogMessages'
import { estimateMessagesForContext } from '../../../../src/main/services/ai/human/memory/multimodal'

const logRecord = (seq: number, entry: ChatMessageLogEntry): ChatMessageLogRecord => ({
  id: `log-${seq}`,
  partnerId: 'partner-split',
  runId: 'run-split',
  seq,
  entry,
  createdAt: seq
})

const user = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input: content,
  context: { selectedReferences: [], attachments: [] }
})

const assistant = (id: string, content: string, extraCalls = 0): ChatMessageLogEntry => ({
  kind: 'assistant',
  content,
  toolCalls: [
    { id, name: 'docx_read_nodes', args: { sourcePath: `${id}.docx` } },
    ...Array.from({ length: extraCalls }, (_, index) => ({
      id: `${id}-${index + 2}`,
      name: 'text_file_read',
      args: { sourcePath: `${id}-${index + 2}.txt` }
    }))
  ]
})

const tool = (id: string, content: string, images?: ChatMessageImageRef[]): ChatMessageLogEntry => ({
  kind: 'tool',
  toolCallId: id,
  toolName: 'docx_read_nodes',
  ok: true,
  content,
  ...(images ? { images } : {})
})

const pair = (seq: number, id: string, aiText: string, toolText: string): ChatMessageLogRecord[] => [
  logRecord(seq, assistant(id, aiText)),
  logRecord(seq + 1, tool(id, toolText))
]

const costOf = (records: ChatMessageLogRecord[]): number =>
  estimateMessagesForContext(messagesFromLogEntries(records.map((record) => record.entry)))

describe('splitLogForCompactionTail', () => {
  it('keeps recent users in the tail instead of stopping at the last user', () => {
    const current = logRecord(4, user('current task'))
    const legal = pair(5, 'legal', 'reading legal', 'legal body')
    const lastPair = pair(7, '2', 'writing draft', 'draft body')
    const earlier = pair(2, '1', 'x'.repeat(2000), 'y'.repeat(2000))
    const records = [logRecord(1, user('old task')), ...earlier, current, ...legal, ...lastPair]
    const split = splitLogForCompactionTail(records, costOf([current, ...legal, ...lastPair]) + 32)
    expect(split.tail[0]?.seq).toBe(4)
    expect(split.tail.at(-1)?.seq).toBe(8)
    expect(split.folded.map((record) => record.entry.kind === 'user' ? record.entry.content : '')).toContain(
      'old task'
    )
    expect(split.folded.some((record) => record.seq === 2)).toBe(true)
  })

  it('does not split an assistant and its tool results', () => {
    const current = logRecord(1, user('fill weekly report'))
    const process = [
      logRecord(
        2,
        assistant('1', 'read both', 1)
      ),
      logRecord(3, tool('1', 'aaa')),
      logRecord(4, {
        kind: 'tool',
        toolCallId: '1-2',
        toolName: 'text_file_read',
        ok: true,
        content: 'bbb'
      })
    ]
    const split = splitLogForCompactionTail(
      [current, ...process],
      costOf(process) - 1
    )
    expect(split.tail.map((record) => record.seq)).toEqual([2, 3, 4])
    expect(split.folded.map((record) => record.seq)).toEqual([1])
  })

  it('keeps a mid-turn split instead of snapping to the nearby user', () => {
    const older = logRecord(1, user('old task'))
    const oldPair = pair(2, '0', 'old', 'old')
    const turnUser = logRecord(4, user('u'.repeat(80)))
    const firstPair = pair(5, '1', 'a'.repeat(40), 't'.repeat(40))
    const lastPair = pair(7, '2', 'b'.repeat(4000), 'c'.repeat(4000))
    const split = splitLogForCompactionTail(
      [older, ...oldPair, turnUser, ...firstPair, ...lastPair],
      costOf([...firstPair, ...lastPair]) - 1
    )
    expect(split.isSplitTurn).toBe(true)
    expect(split.tail.map((record) => record.seq)).toEqual([7, 8])
    expect(split.history[0]?.seq).toBe(1)
    expect(split.turnPrefix[0]?.seq).toBe(4)
    expect(split.folded[0]?.seq).toBe(1)
    expect(split.throughSeq).toBe(6)
    expect(split.firstKeptSeq).toBe(7)
  })

  it('keeps a mid-turn split when the nearby user is farther than 10%', () => {
    const turnUser = logRecord(1, user('u'.repeat(80)))
    const middle = pair(2, '1', 'm'.repeat(8000), 'n'.repeat(8000))
    const lastPair = pair(4, '2', 'b'.repeat(400), 'c'.repeat(400))
    const split = splitLogForCompactionTail([turnUser, ...middle, ...lastPair], costOf(lastPair))
    expect(split.tail.map((record) => record.seq)).toEqual([4, 5])
    expect(split.folded[0]?.seq).toBe(1)
    expect(split.folded.map((record) => record.seq)).toEqual([1, 2, 3])
    expect(split.isSplitTurn).toBe(true)
    expect(split.history).toEqual([])
    expect(split.turnPrefix.map((record) => record.seq)).toEqual([1, 2, 3])
  })

  it('does not treat tool images as a user cut point', () => {
    const current = logRecord(1, user('look at the screenshot'))
    const process = [
      logRecord(2, assistant('1', 'reading image')),
      logRecord(3, {
        kind: 'tool',
        toolCallId: '1',
        toolName: 'read_image',
        ok: true,
        content: 'ok',
        images: [
          {
            path: '/tmp/shot.png',
            mimeType: 'image/png',
            sizeBytes: 8_000,
            width: 1024,
            height: 1024
          }
        ]
      })
    ]
    const split = splitLogForCompactionTail([current, ...process], costOf(process))
    expect(split.folded.map((record) => record.seq)).toEqual([1])
    expect(split.tail.map((record) => record.seq)).toEqual([2, 3])
    expect(split.isSplitTurn).toBe(true)
    expect(split.turnPrefix.map((record) => record.seq)).toEqual([1])
  })

  it('does not treat a compaction checkpoint as a visible boundary', () => {
    const leftover = pair(2, '1', 'x'.repeat(2000), 'y'.repeat(2000))
    const lastPair = pair(4, '2', 'b'.repeat(400), 'c'.repeat(400))
    const records = [
      logRecord(1, {
        kind: 'annotation',
        eventType: 'compaction_checkpoint',
        payload: {
          compactBlockId: 'old',
          throughSeq: 1,
          sourceMessageCount: 2,
          summary: 'checkpoint summary'
        }
      }),
      ...leftover,
      ...lastPair
    ]
    const split = splitLogForCompactionTail(records, costOf(lastPair))
    expect(split.tail.map((record) => record.seq)).toEqual([4, 5])
    expect(split.folded.map((record) => record.seq)).toEqual([2, 3])
    expect(split.isSplitTurn).toBe(false)
    expect(split.turnPrefix).toEqual([])
  })

  it('does not treat a discard checkpoint as a visible boundary', () => {
    const leftover = pair(2, '1', 'x'.repeat(2000), 'y'.repeat(2000))
    const lastPair = pair(4, '2', 'b'.repeat(400), 'c'.repeat(400))
    const records = [
      logRecord(1, {
        kind: 'annotation',
        eventType: 'discard_checkpoint',
        payload: {
          throughSeq: 1,
          conversationHistory: '用户：调研SECRET'
        }
      }),
      ...leftover,
      ...lastPair
    ]
    const split = splitLogForCompactionTail(records, costOf(lastPair))
    expect(split.tail.map((record) => record.seq)).toEqual([4, 5])
    expect(split.folded.map((record) => record.seq)).toEqual([2, 3])
    expect(split.isSplitTurn).toBe(false)
    expect(split.turnPrefix).toEqual([])
  })

  it('treats consecutive users as separate groups', () => {
    const first = logRecord(1, user('first task'))
    const second = logRecord(2, user('second task'))
    const lastPair = pair(3, '1', 'b'.repeat(400), 'c'.repeat(400))
    const split = splitLogForCompactionTail(
      [first, second, ...lastPair],
      costOf([second, ...lastPair])
    )
    expect(split.tail[0]?.seq).toBe(2)
    expect(split.folded.map((record) => record.seq)).toEqual([1])
    expect(split.isSplitTurn).toBe(false)
  })
})

describe('hasCompressibleCompactionHistory', () => {
  it('is false when only a checkpoint sits below the history floor', () => {
    const current = logRecord(2, user('continue'))
    const tail = pair(3, '2', 'current work', 'current result')
    expect(
      hasCompressibleCompactionHistory(
        [
          logRecord(1, {
            kind: 'annotation',
            eventType: 'compaction_checkpoint',
            payload: {
              compactBlockId: 'old',
              throughSeq: 1,
              sourceMessageCount: 2,
              summary: 'checkpoint summary'
            }
          }),
          current,
          ...tail
        ],
        costOf([current, ...tail])
      )
    ).toBe(false)
  })

  it('is false when only a discard checkpoint sits below the history floor', () => {
    const current = logRecord(2, user('continue'))
    const tail = pair(3, '2', 'current work', 'current result')
    expect(
      hasCompressibleCompactionHistory(
        [
          logRecord(1, {
            kind: 'annotation',
            eventType: 'discard_checkpoint',
            payload: {
              throughSeq: 1,
              conversationHistory: '用户：调研SECRET'
            }
          }),
          current,
          ...tail
        ],
        costOf([current, ...tail])
      )
    ).toBe(false)
  })

  it('is false when the keep window covers the whole conversation', () => {
    const current = logRecord(1, user('fill weekly report'))
    const process = pair(2, '1', 'reading', 'nodes')
    expect(hasCompressibleCompactionHistory([current, ...process], costOf([current, ...process]) + 32)).toBe(
      false
    )
  })

  it('is true when a mid-turn split folds the current user', () => {
    const current = logRecord(1, user('fill weekly report'))
    const huge = pair(2, '1', 'x'.repeat(4000), 'y'.repeat(4000))
    expect(
      hasCompressibleCompactionHistory([current, ...huge], Math.floor(costOf(huge) * 0.1))
    ).toBe(true)
  })

  it('is true when earlier users or process remain after taking the tail', () => {
    const current = logRecord(4, user('continue'))
    const earlier = pair(2, '1', 'old work', 'old result')
    const tail = pair(5, '2', 'current work', 'current result')
    expect(
      hasCompressibleCompactionHistory(
        [logRecord(1, user('old task')), ...earlier, current, ...tail],
        costOf([current, ...tail])
      )
    ).toBe(true)
  })
})
