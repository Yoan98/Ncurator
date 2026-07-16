import { describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import { groupSessionFileChanges } from '../../../../src/renderer/src/components/workbench/fileChangeGroups'

const record = (input: Partial<AiFileChangeRecord> & { id: string }): AiFileChangeRecord => ({
  sessionId: 'session-1',
  runId: `run-${input.id}`,
  status: 'applied',
  capability: 'terminal_exec',
  path: input.afterPath || input.beforePath || '',
  fileName: 'file.txt',
  operation: 'updated',
  changeCount: 1,
  insertCount: 0,
  deleteCount: 0,
  createdAt: input.updatedAt || 1,
  updatedAt: input.updatedAt || 1,
  ...input
})

describe('workspace file change groups', () => {
  it('groups chained renames into one logical file', () => {
    const groups = groupSessionFileChanges([
      record({
        id: 'rename-1',
        operation: 'renamed',
        beforePath: '/workspace/a.txt',
        afterPath: '/workspace/b.txt',
        updatedAt: 1
      }),
      record({
        id: 'rename-2',
        operation: 'renamed',
        beforePath: '/workspace/b.txt',
        afterPath: '/workspace/c.txt',
        updatedAt: 2
      })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.latest.id).toBe('rename-2')
    expect(groups[0]?.records).toHaveLength(2)
  })

  it('hides files created and deleted within the same session', () => {
    const groups = groupSessionFileChanges([
      record({
        id: 'create',
        operation: 'created',
        afterPath: '/workspace/temp.txt',
        updatedAt: 1
      }),
      record({
        id: 'delete',
        operation: 'deleted',
        beforePath: '/workspace/temp.txt',
        afterPath: undefined,
        updatedAt: 2
      })
    ])

    expect(groups).toHaveLength(0)
  })
})
