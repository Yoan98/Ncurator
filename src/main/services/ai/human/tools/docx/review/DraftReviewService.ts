import type {
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  DraftReviewDetail,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  SetDraftChangeDecisionRequest,
  SetDraftChangeDecisionResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../../../../storage/domains/DraftReviewStore'
import { DraftReviewCommitService } from './DraftReviewCommitService'
import { DraftReviewStateService } from './DraftReviewStateService'
import { RunDraftTracker } from './RunDraftTracker'

export class DraftReviewService {
  private readonly runDraftTracker: RunDraftTracker
  private readonly stateService: DraftReviewStateService
  private readonly commitService: DraftReviewCommitService

  public constructor(
    private readonly draftReviewStore: DraftReviewStore,
    documentsStore: DocumentsStore
  ) {
    this.runDraftTracker = new RunDraftTracker(documentsStore)
    this.stateService = new DraftReviewStateService(draftReviewStore)
    this.commitService = new DraftReviewCommitService(draftReviewStore)
  }

  public beginRun(input: { runId: string; sessionId: string; inputText: string }): void {
    this.runDraftTracker.beginRun(input)
  }

  public discardRun(runId: string): void {
    this.runDraftTracker.discardRun(runId)
  }

  public registerDocxOpen(input: { runId: string; docId: string; sourcePath: string }): void {
    this.runDraftTracker.registerDocxOpen(input)
  }

  public registerDocxChanges(input: {
    runId: string
    previousDocId: string
    nextDocId: string
    op: Parameters<RunDraftTracker['registerDocxChanges']>[0]['op']
    changedBlocks: Parameters<RunDraftTracker['registerDocxChanges']>[0]['changedBlocks']
  }): void {
    this.runDraftTracker.registerDocxChanges(input)
  }

  public registerDocxPreview(input: { runId: string; docId: string; previewPath: string }): void {
    this.runDraftTracker.registerDocxPreview(input)
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<DraftReviewDetail | null> {
    const detail = await this.runDraftTracker.finalizeRunReview(input)
    if (!detail) return null
    await this.draftReviewStore.saveReviewDetail(detail)
    return detail
  }

  public async listReviews(
    request?: ListDraftReviewsRequest
  ): Promise<ListDraftReviewsResponse> {
    return await this.draftReviewStore.listReviews(request)
  }

  public async getReview(
    request: GetDraftReviewRequest
  ): Promise<GetDraftReviewResponse> {
    const review = await this.draftReviewStore.getReviewDetail(request.reviewId)
    return review ? { review } : { error: 'review not found' }
  }

  public async setChangeDecision(
    request: SetDraftChangeDecisionRequest
  ): Promise<SetDraftChangeDecisionResponse> {
    return await this.stateService.setChangeDecision(request)
  }

  public async validateCommit(
    request: ValidateDraftCommitRequest
  ): Promise<ValidateDraftCommitResponse> {
    return await this.commitService.validateCommit(request)
  }

  public async commitReview(
    request: CommitDraftReviewRequest
  ): Promise<CommitDraftReviewResponse> {
    return await this.commitService.commitReview(request)
  }
}
