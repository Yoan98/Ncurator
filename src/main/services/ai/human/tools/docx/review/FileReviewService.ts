import fs from 'node:fs/promises'
import type {
  CommitFileReviewRequest,
  CommitFileReviewResponse,
  DiscardFileReviewRequest,
  DiscardFileReviewResponse,
  FileReviewDetail,
  GetFileReviewRequest,
  GetFileReviewResponse,
  ListFileReviewsRequest,
  ListFileReviewsResponse,
  ValidateFileReviewCommitRequest,
  ValidateFileReviewCommitResponse
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { FileReviewStore } from '../../../../../storage/domains/FileReviewStore'
import { FileReviewCommitService } from './FileReviewCommitService'
import { RunDraftTracker } from './RunDraftTracker'
import type { ResolvedDocxOpenTarget } from './types'
import { collectArtifactPaths } from './utils'
import { getWorkingArtifactPath } from './viewProjection'

/**
 * FileReviewService currently materializes docx reviews only.
 * Future editable formats should reuse the same FileReview/CommitAttempt outer
 * model while keeping their own tracker, serializer and commit validation logic.
 */
export class FileReviewService {
  private readonly runDraftTracker: RunDraftTracker
  private readonly commitService: FileReviewCommitService

  public constructor(
    private readonly fileReviewStore: FileReviewStore,
    documentsStore: DocumentsStore
  ) {
    this.runDraftTracker = new RunDraftTracker(documentsStore)
    this.commitService = new FileReviewCommitService(fileReviewStore)
  }

  public beginRun(input: { runId: string; sessionId: string; inputText: string }): void {
    this.runDraftTracker.beginRun(input)
  }

  public discardRun(runId: string): void {
    this.runDraftTracker.discardRun(runId)
  }

  public registerDocxOpen(input: {
    runId: string
    docId: string
    sourcePath: string
    replaySession?: Parameters<RunDraftTracker['registerDocxOpen']>[0]['replaySession']
  }): void {
    this.runDraftTracker.registerDocxOpen(input)
  }

  public registerDocxChanges(input: {
    runId: string
    previousDocId: string
    nextDocId: string
    op: Parameters<RunDraftTracker['registerDocxChanges']>[0]['op']
    changedBlocks: Parameters<RunDraftTracker['registerDocxChanges']>[0]['changedBlocks']
    createdBlocks: Parameters<RunDraftTracker['registerDocxChanges']>[0]['createdBlocks']
    replaySession?: Parameters<RunDraftTracker['registerDocxChanges']>[0]['replaySession']
  }): void {
    this.runDraftTracker.registerDocxChanges(input)
  }

  public async materializeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<FileReviewDetail[]> {
    return await this.runDraftTracker.finalizeRunReview(input)
  }

  public async persistMaterializedReviews(
    details: readonly FileReviewDetail[]
  ): Promise<void> {
    for (const detail of details) {
      await this.supersedeActiveReviews(detail.review.source_path, detail.review.id)
      await this.fileReviewStore.saveReviewDetail(detail)
    }
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<FileReviewDetail[]> {
    const details = await this.materializeRunReview(input)
    if (details.length === 0) return []
    await this.persistMaterializedReviews(details)
    return details
  }

  public async listReviews(
    request?: ListFileReviewsRequest
  ): Promise<ListFileReviewsResponse> {
    return await this.fileReviewStore.listReviews(request)
  }

  public async getReview(
    request: GetFileReviewRequest
  ): Promise<GetFileReviewResponse> {
    const review = await this.fileReviewStore.getReviewDetail(request.reviewId)
    return review ? { review } : { error: 'review session not found' }
  }

  public async validateCommit(
    request: ValidateFileReviewCommitRequest
  ): Promise<ValidateFileReviewCommitResponse> {
    return await this.commitService.validateCommit(request)
  }

  public async commitReview(
    request: CommitFileReviewRequest
  ): Promise<CommitFileReviewResponse> {
    return await this.commitService.commitReview(request)
  }

  public async discardReview(
    request: DiscardFileReviewRequest
  ): Promise<DiscardFileReviewResponse> {
    const detail = await this.fileReviewStore.getReviewDetail(request.reviewId)
    if (!detail) return { success: false, error: 'review session not found' }
    if (
      detail.review.status === 'committing' ||
      detail.review.status === 'committed' ||
      detail.review.status === 'discarded'
    ) {
      return { success: false, error: 'current review session cannot be discarded' }
    }

    const updatedReview = {
      ...detail.review,
      status: 'discarded' as const,
      updated_at: Date.now(),
      draft_artifact_path: undefined,
      working_artifact_path: undefined,
      committed_artifact_path: undefined,
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
    await this.fileReviewStore.saveReviewDetail({
      ...detail,
      review: updatedReview
    })
    return {
      success: true,
      review: updatedReview
    }
  }

  public async resolveDocxOpenTarget(sourcePath: string): Promise<ResolvedDocxOpenTarget> {
    const activeReviews = await this.fileReviewStore.listActiveReviewsBySourcePath(sourcePath, [
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

    const workingArtifactPath = getWorkingArtifactPath(activeDetail.review)
    if (!workingArtifactPath) {
      throw new Error('active working draft is missing')
    }
    return {
      openPath: workingArtifactPath,
      trackedSourcePath: sourcePath
    }
  }

  private async supersedeActiveReviews(
    sourcePath: string,
    nextReviewId: string
  ): Promise<void> {
    const activeReviews = await this.fileReviewStore.listActiveReviewsBySourcePath(sourcePath, [
      'pending_confirm',
      'conflicted'
    ])
    for (const detail of activeReviews) {
      if (detail.review.id === nextReviewId) continue
      await this.fileReviewStore.saveReviewDetail({
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
