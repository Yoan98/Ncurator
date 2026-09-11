import { describe, expect, it } from 'vitest'
import type { ChatMessageLogRecord } from '../../../src/shared/types'
import { snapshotMessageLogBookmarks } from '../../harness/backend/messageLogAnnotations'

const record = (
  seq: number,
  entry: ChatMessageLogRecord['entry']
): ChatMessageLogRecord => ({
  id: `id-${seq}`,
  partnerId: 'partner-a',
  runId: 'run-a',
  seq,
  entry,
  createdAt: seq
})

describe('message log annotation snapshots', () => {
  it('keeps compaction and discard bookmarks without prompt or recall text', () => {
    const snapshots = snapshotMessageLogBookmarks([
      record(1, { kind: 'user', content: 'hello', input: 'hello', context: { selectedReferences: [], attachments: [] } }),
      record(2, {
        kind: 'annotation',
        eventType: 'compaction_checkpoint',
        payload: {
          compactBlockId: 'c1',
          throughSeq: 1,
          sourceMessageCount: 4,
          summary: '## 目标\n写周报'
        }
      }),
      record(3, {
        kind: 'annotation',
        eventType: 'discard_checkpoint',
        payload: {
          throughSeq: 3,
          conversationHistory: '用户：ALPHA\n交付：已确认'
        }
      }),
      record(4, {
        kind: 'annotation',
        eventType: 'context_scope_decided',
        payload: {
          needsHistory: false,
          basis: 'model_decision',
          budgetTokens: 12
        }
      })
    ])

    expect(snapshots).toEqual([
      {
        partnerId: 'partner-a',
        seq: 2,
        runId: 'run-a',
        createdAt: 2,
        eventType: 'compaction_checkpoint',
        throughSeq: 1,
        compactBlockId: 'c1',
        sourceMessageCount: 4,
        summaryChars: '## 目标\n写周报'.length
      },
      {
        partnerId: 'partner-a',
        seq: 3,
        runId: 'run-a',
        createdAt: 3,
        eventType: 'discard_checkpoint',
        throughSeq: 3,
        conversationHistoryChars: '用户：ALPHA\n交付：已确认'.length
      }
    ])
    expect(JSON.stringify(snapshots)).not.toContain('写周报')
    expect(JSON.stringify(snapshots)).not.toContain('ALPHA')
  })
})
