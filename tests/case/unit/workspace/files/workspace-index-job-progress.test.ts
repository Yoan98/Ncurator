import { describe, expect, it } from 'vitest'
import {
  formatIndexJobProgressLabel,
  getIndexJobProgressNumbers,
  INDEX_JOB_PROGRESS_LABEL_PATTERN
} from '../../../../../src/shared/indexJobProgress'

describe('unit workspace files', () => {
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
    expect(formatIndexJobProgressLabel(oneFilePending)).toBe('0% · 0/1')
    expect(INDEX_JOB_PROGRESS_LABEL_PATTERN.test(formatIndexJobProgressLabel(oneFilePending))).toBe(
      true
    )

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
    expect(formatIndexJobProgressLabel(halfDone)).toBe('50% · 2/4')
  })
})
