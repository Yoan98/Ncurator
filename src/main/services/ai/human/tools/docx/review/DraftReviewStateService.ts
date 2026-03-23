import type {
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary,
  SetDraftChangeDecisionRequest,
  SetDraftChangeDecisionResponse
} from '../../../../../../../shared/types'
import type { DraftReviewStore } from '../../../../../storage/domains/DraftReviewStore'
import { toReviewStatus } from './utils'

export class DraftReviewStateService {
  public constructor(private readonly draftReviewStore: DraftReviewStore) {}

  public async setChangeDecision(
    request: SetDraftChangeDecisionRequest
  ): Promise<SetDraftChangeDecisionResponse> {
    const review = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!review) return { success: false, error: 'review not found' }

    const updatedChange = await this.draftReviewStore.updateChangeDecision(
      request.reviewId,
      request.changeId,
      request.decision
    )
    if (!updatedChange) return { success: false, error: 'change not found' }

    const nextDetail = await this.rebuildReviewState(request.reviewId)
    const nextDocument = nextDetail.documents.find((item) => item.id === updatedChange.document_id)
    const nextChange = nextDetail.changes.find((item) => item.id === updatedChange.id)
    return {
      success: true,
      review: nextDetail.review,
      document: nextDocument,
      change: nextChange
    }
  }

  public async rebuildReviewState(reviewId: string): Promise<DraftReviewDetail> {
    const detail = await this.draftReviewStore.getReviewDetail(reviewId)
    if (!detail) throw new Error('review not found')

    const updatedAt = Date.now()
    const documentMap = new Map<string, DraftReviewDocument>(
      detail.documents.map((document) => [
        document.id,
        {
          ...document,
          pending_change_count: 0,
          accepted_change_count: 0,
          rejected_change_count: 0,
          total_change_count: 0,
          updated_at: updatedAt
        }
      ])
    )

    detail.changes.forEach((change) => {
      const document = documentMap.get(change.document_id)
      if (!document) return
      document.total_change_count += 1
      if (change.decision === 'accepted') document.accepted_change_count += 1
      else if (change.decision === 'rejected') document.rejected_change_count += 1
      else document.pending_change_count += 1
    })

    const documents = [...documentMap.values()]
    const pendingCount = detail.changes.filter((change) => change.decision === 'pending').length
    const acceptedCount = detail.changes.filter((change) => change.decision === 'accepted').length
    const rejectedCount = detail.changes.filter((change) => change.decision === 'rejected').length
    const review: DraftReviewSummary = {
      ...detail.review,
      status: toReviewStatus(pendingCount > 0, detail.review.status),
      change_count: detail.changes.length,
      pending_change_count: pendingCount,
      accepted_change_count: acceptedCount,
      rejected_change_count: rejectedCount,
      updated_at: updatedAt,
      last_error: undefined
    }

    await this.draftReviewStore.saveReview(review)
    await this.draftReviewStore.replaceDocuments(reviewId, documents)
    return {
      review,
      documents,
      changes: detail.changes,
      commit_jobs: detail.commit_jobs
    }
  }

  public async updateReviewSummary(review: DraftReviewSummary): Promise<void> {
    await this.draftReviewStore.saveReview(review)
  }
}
