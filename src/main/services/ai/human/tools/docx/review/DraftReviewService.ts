import fs from 'node:fs/promises'
import type {
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  DiscardDraftReviewRequest,
  DiscardDraftReviewResponse,
  DraftReviewDetail,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../../../../storage/domains/DraftReviewStore'
import { DraftReviewCommitService } from './DraftReviewCommitService'
import { normalizeDocxConfirmCopy } from './confirmCopy'
import { RunDraftTracker } from './RunDraftTracker'
import type { ResolvedDocxOpenTarget } from './types'
import { collectArtifactPaths, getManifestPathForConfirmArtifact } from './utils'

export class DraftReviewService {
  private readonly runDraftTracker: RunDraftTracker
  private readonly commitService: DraftReviewCommitService

  public constructor(
    private readonly draftReviewStore: DraftReviewStore,
    documentsStore: DocumentsStore
  ) {
    this.runDraftTracker = new RunDraftTracker(documentsStore)
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

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<DraftReviewDetail[]> {
    const details = await this.runDraftTracker.finalizeRunReview(input)
    if (details.length === 0) return []
    for (const detail of details) {
      const sourcePath = detail.documents[0]?.source_path
      if (sourcePath) {
        await this.supersedeActiveReviews(sourcePath, detail.review.id)
      }
      await this.draftReviewStore.saveReviewDetail(detail)
    }
    return details
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
    return review ? { review } : { error: 'confirm session not found' }
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

  public async discardReview(
    request: DiscardDraftReviewRequest
  ): Promise<DiscardDraftReviewResponse> {
    const detail = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!detail) return { success: false, error: 'confirm session not found' }
    if (
      detail.review.status === 'committing' ||
      detail.review.status === 'committed' ||
      detail.review.status === 'discarded'
    ) {
      return { success: false, error: 'current confirm session cannot be discarded' }
    }

    const updatedReview = {
      ...detail.review,
      status: 'discarded' as const,
      updated_at: Date.now(),
      last_error: undefined
    }
    await Promise.all(
      collectArtifactPaths(detail).map(async (artifactPath) => {
        try {
          await fs.rm(artifactPath, { force: true })
        } catch {
          return
        }
      })
    )
    await this.draftReviewStore.saveReviewDetail({
      ...detail,
      review: updatedReview,
      documents: detail.documents.map((document) => ({
        ...document,
        confirm_artifact_path: undefined,
        manifest_artifact_path: undefined,
        effective_draft_artifact_path: undefined,
        updated_at: updatedReview.updated_at
      }))
    })
    return {
      success: true,
      review: updatedReview
    }
  }

  public async resolveDocxOpenTarget(sourcePath: string): Promise<ResolvedDocxOpenTarget> {
    const activeReviews = await this.draftReviewStore.listActiveReviewsBySourcePath(sourcePath, [
      'pending_confirm',
      'conflicted'
    ])
    const activeDetail = activeReviews[0]
    if (!activeDetail) {
      return {
        openPath: sourcePath,
        trackedSourcePath: sourcePath
      }
    }

    const document = activeDetail.documents.find((item) => item.source_path === sourcePath)
    if (!document?.confirm_artifact_path) {
      throw new Error('active confirm copy is missing')
    }
    const manifestArtifactPath =
      document.manifest_artifact_path ||
      getManifestPathForConfirmArtifact(document.confirm_artifact_path)
    const effectiveDraftPath =
      document.effective_draft_artifact_path ||
      document.confirm_artifact_path.replace(/\.docx$/i, '.effective.docx')
    await normalizeDocxConfirmCopy({
      confirmArtifactPath: document.confirm_artifact_path,
      manifestArtifactPath,
      outPath: effectiveDraftPath
    })
    return {
      openPath: effectiveDraftPath,
      trackedSourcePath: sourcePath
    }
  }

  private async supersedeActiveReviews(
    sourcePath: string,
    nextReviewId: string
  ): Promise<void> {
    const activeReviews = await this.draftReviewStore.listActiveReviewsBySourcePath(sourcePath, [
      'pending_confirm',
      'conflicted'
    ])
    for (const detail of activeReviews) {
      if (detail.review.id === nextReviewId) continue
      await this.draftReviewStore.saveReviewDetail({
        ...detail,
        review: {
          ...detail.review,
          status: 'superseded',
          updated_at: Date.now()
        }
      })
    }
  }
}
