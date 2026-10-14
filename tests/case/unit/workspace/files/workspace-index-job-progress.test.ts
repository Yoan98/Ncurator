import { describe, expect, it } from 'vitest'
import { getIndexJobProgressNumbers } from '../../../../../src/shared/indexJobProgress'
import { resolveCancelledPrepareJobStatus } from '../../../../../src/main/services/workspace/WorkspaceIndexPrepareController'

describe('unit workspace files', () => {
  it('preserves completed terminal states and cancels unfinished work', () => {
    const completed = {
      unfinishedCount: 0,
      processedCount: 3,
      totalCount: 3,
      failedCount: 0
    }
    expect(resolveCancelledPrepareJobStatus(completed)).toBe('succeeded')
    expect(resolveCancelledPrepareJobStatus({ ...completed, failedCount: 1 })).toBe('failed')
    expect(
      resolveCancelledPrepareJobStatus({
        unfinishedCount: 1,
        processedCount: 2,
        totalCount: 3,
        failedCount: 0
      })
    ).toBe('cancelled')
  })

  it('workspace-index-job-progress', () => {
    expect(
      getIndexJobProgressNumbers({ total_count: 0, processed_count: 0, failed_count: 0 })
    ).toEqual({
      total: 0,
      done: 0,
      percent: 0,
      hasDeterminateProgress: false
    })

    const oneFilePending = getIndexJobProgressNumbers({
      total_count: 1,
      processed_count: 0,
      failed_count: 0
    })
    expect(oneFilePending).toEqual({
      total: 1,
      done: 0,
      percent: 0,
      hasDeterminateProgress: true
    })

    const halfDone = getIndexJobProgressNumbers({
      total_count: 4,
      processed_count: 2,
      failed_count: 0
    })
    expect(halfDone).toEqual({
      total: 4,
      done: 2,
      percent: 50,
      hasDeterminateProgress: true
    })

    const failedItemsAreNotCountedTwice = getIndexJobProgressNumbers({
      total_count: 30,
      processed_count: 23,
      failed_count: 20
    })
    expect(failedItemsAreNotCountedTwice).toEqual({
      total: 30,
      done: 23,
      percent: 77,
      hasDeterminateProgress: true
    })
  })
})
