import { describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import {
  createFileChangeListRequest,
  filterFileChangeRecordsForScope,
  groupFileChangeRecordsByRun,
  isCurrentFileChangeRunScope
} from '../../../../src/shared/aiFileChangeScope'

const record = (input: Partial<AiFileChangeRecord>): AiFileChangeRecord => ({
  id: input.id || 'change-1',
  sessionId: input.sessionId || 'session-a',
  runId: input.runId || 'run-a',
  status: 'applied',
  capability: 'text_file',
  path: input.path || '/workspace/file.txt',
  fileName: input.fileName || 'file.txt',
  operation: 'updated',
  changeCount: 1,
  insertCount: 1,
  deleteCount: 0,
  createdAt: 1,
  updatedAt: input.updatedAt || 1
})

describe('ai unit file change run scope', () => {
  it('keeps the right panel request and records within one session and run', () => {
    const scope = { sessionId: 'session-a', runId: 'run-a' }
    const records = [
      record({ id: 'a', sessionId: 'session-a', runId: 'run-a', path: '/workspace/a.txt' }),
      record({ id: 'b', sessionId: 'session-a', runId: 'run-b', path: '/workspace/b.txt' }),
      record({ id: 'c', sessionId: 'session-b', runId: 'run-a', path: '/workspace/c.txt' })
    ]

    expect(createFileChangeListRequest(scope)).toEqual({ sessionId: 'session-a', runId: 'run-a' })
    expect(filterFileChangeRecordsForScope(records, scope).map((item) => item.id)).toEqual(['a'])
  })

  it('ignores completion events for another session or run', () => {
    const scope = { sessionId: 'session-a', runId: 'run-a' }

    expect(isCurrentFileChangeRunScope(scope, scope)).toBe(true)
    expect(isCurrentFileChangeRunScope(scope, { sessionId: 'session-a', runId: 'run-b' })).toBe(
      false
    )
    expect(isCurrentFileChangeRunScope(scope, { sessionId: 'session-b', runId: 'run-a' })).toBe(
      false
    )
  })

  it('keeps assistant history entries grouped by their own run', () => {
    const groups = groupFileChangeRecordsByRun([
      record({ id: 'a', runId: 'run-a', path: '/workspace/a.txt', updatedAt: 2 }),
      record({ id: 'b', runId: 'run-b', path: '/workspace/b.txt', updatedAt: 3 })
    ])

    expect(groups.get('run-a')?.map((item) => item.id)).toEqual(['a'])
    expect(groups.get('run-b')?.map((item) => item.id)).toEqual(['b'])
  })
})
