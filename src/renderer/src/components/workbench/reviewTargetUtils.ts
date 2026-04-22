import type { FileReview } from '../../../../shared/types'
import type { AssistantTurnReviewTarget } from './types'

export const buildReviewTarget = (review: FileReview): AssistantTurnReviewTarget => ({
  reviewId: review.id,
  title: review.title,
  changeCount: review.change_count,
  documentCount: 1,
  status: review.status
})

export const mergeReviewTargets = (
  current: AssistantTurnReviewTarget[],
  next: AssistantTurnReviewTarget
): AssistantTurnReviewTarget[] => [
  next,
  ...current.filter((item) => item.reviewId !== next.reviewId)
]

export const groupReviewTargetsByRunId = (
  reviews: FileReview[]
): Map<string, AssistantTurnReviewTarget[]> => {
  const grouped = new Map<string, FileReview[]>()
  reviews.forEach((review) => {
    const existing = grouped.get(review.run_id) || []
    existing.push(review)
    grouped.set(review.run_id, existing)
  })

  return new Map(
    [...grouped.entries()].map(([runId, runReviews]) => [
      runId,
      runReviews
        .slice()
        .sort((left, right) => right.updated_at - left.updated_at)
        .map((review) => buildReviewTarget(review))
    ])
  )
}
