import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  DraftCommitJob,
  DraftCommitResultItem,
  DraftCommitValidationIssue,
  DraftReviewDocument,
  DraftReviewSummary,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse
} from '../../../../../../../shared/types'
import type { DraftReviewStore } from '../../../../../storage/domains/DraftReviewStore'
import { normalizeDocxConfirmCopy } from './confirmCopy'
import {
  collectArtifactPaths,
  createArchivedCommittedDetail,
  getManifestPathForConfirmArtifact,
  isSourceVersionFresh
} from './utils'

const buildTempOutputPath = (sourcePath: string, suffix: string): string =>
  path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}.${suffix}.tmp`)

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const mapConfirmCopyInvalidMessage = (errorMessage: string): string => {
  if (errorMessage.includes('confirm_copy_external_revisions')) {
    return '确认副本包含外部修订，请先在 Word/WPS 中接受或拒绝修订后重试。'
  }
  return '确认副本结构已损坏，需要重新生成。'
}

const readFileStats = async (
  filePath: string
): Promise<{ checksum: string; byteSize: number }> => {
  const buffer = await fs.readFile(filePath)
  return {
    checksum: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.byteLength
  }
}

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
            code: 'session_not_found',
            message: '确认文档不存在或已被移除。'
          }
        ]
      }
    }

    const issues: DraftCommitValidationIssue[] = []
    const status = detail.review.status
    if (
      status === 'committing' ||
      status === 'committed' ||
      status === 'discarded' ||
      status === 'superseded'
    ) {
      issues.push({
        code: 'session_not_ready',
        message: '当前确认文档状态不允许提交。'
      })
    }

    const documentIssues = await Promise.all(
      detail.documents.map(async (document) => await this.validateDocument(detail.review.id, document))
    )
    documentIssues.forEach((documentIssueList) => {
      issues.push(...documentIssueList)
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
    if (!detail) return { success: false, error: 'confirm session not found' }
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
      document_count: detail.documents.length,
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

    const results: DraftCommitResultItem[] = []
    const tempPaths: string[] = []

    try {
      for (const document of detail.documents) {
        const confirmPath = document.confirm_artifact_path
        if (!confirmPath) {
          throw new Error(`missing confirm artifact for ${document.source_name}`)
        }
        const manifestArtifactPath =
          document.manifest_artifact_path || getManifestPathForConfirmArtifact(confirmPath)

        const normalizedTempPath =
          document.effective_draft_artifact_path ||
          buildTempOutputPath(document.source_path, `normalized-${job.id}`)
        const sourceTempPath = buildTempOutputPath(document.source_path, `commit-${job.id}`)
        tempPaths.push(normalizedTempPath, sourceTempPath)

        await normalizeDocxConfirmCopy({
          confirmArtifactPath: confirmPath,
          manifestArtifactPath,
          outPath: normalizedTempPath
        })
        const normalizedBuffer = await fs.readFile(normalizedTempPath)
        await fs.writeFile(sourceTempPath, normalizedBuffer)
        await fs.rename(sourceTempPath, document.source_path)

        const stats = await readFileStats(document.source_path)
        results.push({
          draft_document_id: document.id,
          output_path: document.source_path,
          operation: 'updated',
          checksum: stats.checksum,
          byte_size: stats.byteSize
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
        [...collectArtifactPaths(detail), ...tempPaths].map(async (artifactPath) => {
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
      await Promise.all(
        tempPaths.map(async (artifactPath) => {
          try {
            await fs.rm(artifactPath, { force: true })
          } catch {
            return
          }
        })
      )
      return {
        success: false,
        job: failedJob,
        error: message
      }
    }
  }

  private async validateDocument(
    reviewId: string,
    document: DraftReviewDocument
  ): Promise<DraftCommitValidationIssue[]> {
    const issues: DraftCommitValidationIssue[] = []
    if (!document.confirm_artifact_path) {
      issues.push({
        code: 'confirm_copy_missing',
        message: '确认副本不存在，无法提交。',
        documentId: document.id,
        sourcePath: document.source_path
      })
      return issues
    }

    if (!(await fileExists(document.confirm_artifact_path))) {
      issues.push({
        code: 'confirm_copy_missing',
        message: '确认副本已丢失，需要重新生成。',
        documentId: document.id,
        sourcePath: document.source_path
      })
      return issues
    }
    const manifestArtifactPath =
      document.manifest_artifact_path ||
      getManifestPathForConfirmArtifact(document.confirm_artifact_path)
    if (!(await fileExists(manifestArtifactPath))) {
      issues.push({
        code: 'confirm_copy_invalid',
        message: '确认副本结构已损坏，需要重新生成。',
        documentId: document.id,
        sourcePath: document.source_path
      })
      return issues
    }

    const fresh = await isSourceVersionFresh(document.source_path, document.source_version)
    if (!fresh) {
      issues.push({
        code: 'source_changed',
        message: '源文件已发生变化，无法基于旧确认文档直接替换。',
        documentId: document.id,
        sourcePath: document.source_path
      })
    }

    const validationTempPath = buildTempOutputPath(
      document.source_path,
      `validate-${reviewId}-${document.id}`
    )
    try {
      await normalizeDocxConfirmCopy({
        confirmArtifactPath: document.confirm_artifact_path,
        manifestArtifactPath,
        outPath: validationTempPath
      })
      await fs.rm(validationTempPath, { force: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({
        code: /busy|lock|perm/i.test(message) ? 'confirm_copy_locked' : 'confirm_copy_invalid',
        message: /busy|lock|perm/i.test(message)
          ? '确认副本当前被其他应用占用，请关闭后重试。'
          : mapConfirmCopyInvalidMessage(message),
        documentId: document.id,
        sourcePath: document.source_path
      })
      try {
        await fs.rm(validationTempPath, { force: true })
      } catch {
        return issues
      }
    }

    return issues
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
      await this.updateReviewSummary({
        ...input.review,
        status: 'conflicted',
        updated_at: now,
        last_error: errorMessage
      })
    }

    return {
      success: false,
      job: conflictJob,
      error: errorMessage
    }
  }

  private async appendCommitJob(reviewId: string, job: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...jobs, job])
  }

  private async replaceCommitJob(reviewId: string, nextJob: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    const filtered = jobs.filter((job) => job.id !== nextJob.id)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...filtered, nextJob])
  }

  private async updateReviewSummary(review: DraftReviewSummary): Promise<void> {
    await this.draftReviewStore.saveReview(review)
  }
}
