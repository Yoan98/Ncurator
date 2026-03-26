import type { DraftReviewSummary } from '../../../src/shared/types'
import {
  groupReviewTargetsByRunId,
  mergeReviewTargets
} from '../../../src/renderer/src/components/workbench/reviewTargetUtils'

const createReviewSummary = (
  input: Partial<DraftReviewSummary> & Pick<DraftReviewSummary, 'id' | 'run_id' | 'updated_at'>
): DraftReviewSummary => ({
  id: input.id,
  session_id: input.session_id || 'session-1',
  run_id: input.run_id,
  status: input.status || 'pending_confirm',
  title: input.title || `Review ${input.id}`,
  document_count: input.document_count || 1,
  change_count: input.change_count || 1,
  pending_change_count: input.pending_change_count || 1,
  accepted_change_count: input.accepted_change_count || 0,
  rejected_change_count: input.rejected_change_count || 0,
  created_at: input.created_at || 1,
  updated_at: input.updated_at,
  completed_at: input.completed_at,
  committed_at: input.committed_at,
  last_error: input.last_error
})

describe('reviewTargetUtils', () => {
  it('groups all reviews under the same run and sorts them by updated_at descending', () => {
    const grouped = groupReviewTargetsByRunId([
      createReviewSummary({ id: 'review-a', run_id: 'run-1', updated_at: 100 }),
      createReviewSummary({ id: 'review-b', run_id: 'run-1', updated_at: 300 }),
      createReviewSummary({ id: 'review-c', run_id: 'run-2', updated_at: 200 })
    ])

    expect(grouped.get('run-1')).toEqual([
      {
        reviewId: 'review-b',
        title: 'Review review-b',
        changeCount: 1,
        documentCount: 1,
        status: 'pending_confirm'
      },
      {
        reviewId: 'review-a',
        title: 'Review review-a',
        changeCount: 1,
        documentCount: 1,
        status: 'pending_confirm'
      }
    ])
    expect(grouped.get('run-2')).toEqual([
      {
        reviewId: 'review-c',
        title: 'Review review-c',
        changeCount: 1,
        documentCount: 1,
        status: 'pending_confirm'
      }
    ])
  })

  it('prepends latest target updates and deduplicates by reviewId', () => {
    const merged = mergeReviewTargets(
      [
        {
          reviewId: 'review-a',
          title: '旧 review-a',
          changeCount: 2,
          documentCount: 1,
          status: 'pending_confirm'
        },
        {
          reviewId: 'review-b',
          title: 'review-b',
          changeCount: 1,
          documentCount: 1,
          status: 'failed'
        }
      ],
      {
        reviewId: 'review-a',
        title: '新 review-a',
        changeCount: 3,
        documentCount: 1,
        status: 'committed'
      }
    )

    expect(merged).toEqual([
      {
        reviewId: 'review-a',
        title: '新 review-a',
        changeCount: 3,
        documentCount: 1,
        status: 'committed'
      },
      {
        reviewId: 'review-b',
        title: 'review-b',
        changeCount: 1,
        documentCount: 1,
        status: 'failed'
      }
    ])
  })
})
