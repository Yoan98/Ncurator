import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type {
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  DraftCommitJob,
  DraftCommitResultItem,
  DraftCommitValidationIssue,
  DraftReviewSummary,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse
} from '../../../../../../../shared/types'
import type { DraftReviewStore } from '../../../../../storage/domains/DraftReviewStore'
import { getDocxWorkerClient, releaseDocxRunSession } from '../worker/docxWorkerClient'
import {
  collectArtifactPaths,
  createArchivedCommittedDetail,
  getMetadataGroupId,
  isSourceVersionFresh,
  parseDocxOpFromMetadata
} from './utils'

export class DraftReviewCommitService {
  public constructor(private readonly draftReviewStore: DraftReviewStore) {}

  public async validateCommit(
    request: ValidateDraftCommitRequest
  ): Promise<ValidateDraftCommitResponse> {
    const detail = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!detail) {
      return {
        ready: false,
        issues: [
          {
            code: 'review_not_found',
            message: '草稿审阅不存在或已被移除。'
          }
        ]
      }
    }

    const issues: DraftCommitValidationIssue[] = []
    const status = detail.review.status
    if (status === 'committing' || status === 'committed' || status === 'cancelled') {
      issues.push({
        code: 'review_not_ready',
        message: '当前草稿状态不允许提交。'
      })
    }

    if (detail.changes.some((change) => change.decision === 'pending')) {
      issues.push({
        code: 'pending_changes',
        message: '仍有未决修改，必须先逐块接受或拒绝。'
      })
    }

    const freshnessResults = await Promise.all(
      detail.documents.map(async (document) => ({
        document,
        fresh: await isSourceVersionFresh(document.source_path, document.source_version)
      }))
    )
    freshnessResults.forEach(({ document, fresh }) => {
      if (!fresh) {
        issues.push({
          code: 'source_changed',
          message: '源文件已发生变化，无法基于旧草稿直接提交。',
          documentId: document.id,
          sourcePath: document.source_path
        })
      }
    })

    return {
      ready: issues.length === 0,
      issues
    }
  }

  public async commitReview(
    request: CommitDraftReviewRequest
  ): Promise<CommitDraftReviewResponse> {
    const detail = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!detail) return { success: false, error: 'review not found' }
    if (!request.overwrite) {
      return { success: false, error: 'overwrite confirmation is required' }
    }

    const validation = await this.validateCommit({ reviewId: request.reviewId })
    if (!validation.ready) {
      return await this.handleValidationFailure({
        request,
        review: detail.review,
        documentCount: detail.documents.length,
        issues: validation.issues
      })
    }

    const now = Date.now()
    const job: DraftCommitJob = {
      id: randomUUID(),
      review_id: request.reviewId,
      status: 'running',
      document_count: detail.documents.filter((document) =>
        detail.changes.some(
          (change) => change.document_id === document.id && change.decision === 'accepted'
        )
      ).length,
      results: [],
      started_at: now
    }
    await this.appendCommitJob(request.reviewId, job)
    await this.updateReviewSummary({
      ...detail.review,
      status: 'committing',
      updated_at: now,
      last_error: undefined
    })

    const commitRunId = `draft-commit-${job.id}`
    const results: DraftCommitResultItem[] = []

    try {
      const client = getDocxWorkerClient()
      for (const document of detail.documents) {
        const acceptedChanges = detail.changes
          .filter((change) => change.document_id === document.id && change.decision === 'accepted')
          .sort((left, right) => left.order_index - right.order_index)
        if (acceptedChanges.length === 0) continue

        const openResponse = await client.call({
          runId: commitRunId,
          action: 'open',
          payload: {
            sourcePath: document.source_path
          }
        })
        if (!openResponse.ok || openResponse.payload.action !== 'open') {
          throw new Error(openResponse.ok ? 'commit open worker protocol mismatch' : openResponse.error)
        }

        let currentDocId = openResponse.payload.docId
        const appliedGroups = new Set<string>()
        for (const change of acceptedChanges) {
          const groupId = getMetadataGroupId(change.metadata)
          if (groupId && appliedGroups.has(groupId)) continue
          if (groupId) appliedGroups.add(groupId)

          const op = parseDocxOpFromMetadata(change.metadata)
          if (!op) throw new Error(`missing docx op metadata for change ${change.id}`)

          const applyResponse = await client.call({
            runId: commitRunId,
            action: 'apply_ops',
            payload: {
              docId: currentDocId,
              ops: [op]
            }
          })
          if (!applyResponse.ok || applyResponse.payload.action !== 'apply_ops') {
            throw new Error(
              applyResponse.ok ? 'commit apply worker protocol mismatch' : applyResponse.error
            )
          }
          currentDocId = applyResponse.payload.newDocId
        }

        const saveResponse = await client.call({
          runId: commitRunId,
          action: 'save',
          payload: {
            docId: currentDocId,
            outPath: document.source_path
          }
        })
        if (!saveResponse.ok || saveResponse.payload.action !== 'save') {
          throw new Error(saveResponse.ok ? 'commit save worker protocol mismatch' : saveResponse.error)
        }

        results.push({
          draft_document_id: document.id,
          output_path: document.source_path,
          operation: 'updated',
          checksum: saveResponse.payload.checksum,
          byte_size: saveResponse.payload.byteSize
        })
      }

      const completedJob: DraftCommitJob = {
        ...job,
        status: 'completed',
        results,
        completed_at: Date.now()
      }
      const committedAt = completedJob.completed_at || Date.now()
      const archivedDetail = createArchivedCommittedDetail({
        detail,
        completedJob,
        committedAt
      })
      await this.draftReviewStore.saveReviewDetail(archivedDetail)
      await Promise.all(
        collectArtifactPaths(detail).map(async (artifactPath) => {
          try {
            await fs.rm(artifactPath, { force: true })
          } catch {
            return
          }
        })
      )
      return {
        success: true,
        job: completedJob
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedJob: DraftCommitJob = {
        ...job,
        status: 'failed',
        results,
        completed_at: Date.now(),
        error: message
      }
      await this.replaceCommitJob(request.reviewId, failedJob)
      await this.updateReviewSummary({
        ...detail.review,
        status: 'failed',
        updated_at: Date.now(),
        last_error: message
      })
      return {
        success: false,
        job: failedJob,
        error: message
      }
    } finally {
      await releaseDocxRunSession(commitRunId)
    }
  }

  private async handleValidationFailure(input: {
    request: CommitDraftReviewRequest
    review: DraftReviewSummary
    documentCount: number
    issues: DraftCommitValidationIssue[]
  }): Promise<CommitDraftReviewResponse> {
    const hasConflict = input.issues.some((issue) => issue.code === 'source_changed')
    const now = Date.now()
    const errorMessage = input.issues.map((issue) => issue.message).join('；')
    let conflictJob: DraftCommitJob | undefined

    if (hasConflict) {
      conflictJob = {
        id: randomUUID(),
        review_id: input.request.reviewId,
        status: 'conflicted',
        document_count: input.documentCount,
        results: [],
        started_at: now,
        completed_at: now,
        error: errorMessage
      }
      await this.appendCommitJob(input.request.reviewId, conflictJob)
    }

    await this.updateReviewSummary({
      ...input.review,
      status: hasConflict ? 'conflicted' : input.review.status,
      updated_at: now,
      last_error: errorMessage
    })

    return {
      success: false,
      job: conflictJob,
      error: errorMessage
    }
  }

  private async updateReviewSummary(review: DraftReviewSummary): Promise<void> {
    await this.draftReviewStore.saveReview(review)
  }

  private async appendCommitJob(reviewId: string, nextJob: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...jobs, nextJob])
  }

  private async replaceCommitJob(reviewId: string, nextJob: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    const withoutCurrent = jobs.filter((job) => job.id !== nextJob.id)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...withoutCurrent, nextJob])
  }
}
