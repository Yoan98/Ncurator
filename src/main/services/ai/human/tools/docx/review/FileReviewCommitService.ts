import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CommitAttempt,
  CommitResultItem,
  CommitValidationIssue,
  CommitFileReviewRequest,
  CommitFileReviewResponse,
  FileReview,
  ValidateFileReviewCommitRequest,
  ValidateFileReviewCommitResponse
} from '../../../../../../../shared/types'
import type { FileReviewStore } from '../../../../../storage/domains/FileReviewStore'
import {
  collectArtifactPaths,
  createArchivedCommittedDetail,
  isSourceVersionFresh
} from './utils'
import {
  getCommittedArtifactPath,
  getDraftArtifactPath,
  getWorkingArtifactPath
} from './viewProjection'

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

const readFileStats = async (
  filePath: string
): Promise<{ checksum: string; byteSize: number }> => {
  const buffer = await fs.readFile(filePath)
  return {
    checksum: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.byteLength
  }
}

export class FileReviewCommitService {
  public constructor(private readonly fileReviewStore: FileReviewStore) {}

  public async validateCommit(
    request: ValidateFileReviewCommitRequest
  ): Promise<ValidateFileReviewCommitResponse> {
    const detail = await this.fileReviewStore.getReviewDetail(request.reviewId)
    if (!detail) {
      return {
        ready: false,
        issues: [{ code: 'session_not_found', message: '审阅稿不存在或已被移除。' }]
      }
    }

    const issues: CommitValidationIssue[] = []
    const status = detail.review.status
    if (
      status === 'committing' ||
      status === 'committed' ||
      status === 'discarded' ||
      status === 'superseded'
    ) {
      issues.push({
        code: 'session_not_ready',
        message: '当前审阅稿状态不允许提交。'
      })
    }

    issues.push(...(await this.validateReview(detail.review)))
    return { ready: issues.length === 0, issues }
  }

  public async commitReview(
    request: CommitFileReviewRequest
  ): Promise<CommitFileReviewResponse> {
    const detail = await this.fileReviewStore.getReviewDetail(request.reviewId)
    if (!detail) return { success: false, error: 'review session not found' }
    if (!request.overwrite) {
      return { success: false, error: 'overwrite confirmation is required' }
    }

    const validation = await this.validateCommit({ reviewId: request.reviewId })
    if (!validation.ready) {
      return await this.handleValidationFailure({
        request,
        review: detail.review,
        issues: validation.issues
      })
    }

    const now = Date.now()
    const attempt: CommitAttempt = {
      id: randomUUID(),
      review_id: request.reviewId,
      status: 'running',
      results: [],
      started_at: now
    }
    await this.appendCommitAttempt(request.reviewId, attempt)
    await this.updateReviewSummary({
      ...detail.review,
      status: 'committing',
      updated_at: now,
      last_error: undefined
    })

    const tempPaths: string[] = []

    try {
      const committedArtifactPath = getCommittedArtifactPath(detail.review)
      if (!committedArtifactPath) {
        throw new Error(`missing committed view for ${detail.review.source_name}`)
      }
      const sourceTempPath = buildTempOutputPath(detail.review.source_path, `commit-${attempt.id}`)
      tempPaths.push(sourceTempPath)

      const committedBuffer = await fs.readFile(committedArtifactPath)
      await fs.mkdir(path.dirname(sourceTempPath), { recursive: true })
      await fs.writeFile(sourceTempPath, committedBuffer)
      await fs.rename(sourceTempPath, detail.review.source_path)

      const stats = await readFileStats(detail.review.source_path)
      const results: CommitResultItem[] = [
        {
          review_id: detail.review.id,
          output_path: detail.review.source_path,
          operation: detail.review.output_operation,
          checksum: stats.checksum,
          byte_size: stats.byteSize
        }
      ]

      const completedAttempt: CommitAttempt = {
        ...attempt,
        status: 'completed',
        results,
        completed_at: Date.now()
      }
      const committedAt = completedAttempt.completed_at || Date.now()
      const archivedDetail = createArchivedCommittedDetail({
        detail,
        completedAttempt,
        committedAt
      })
      await this.fileReviewStore.saveReviewDetail(archivedDetail)
      await Promise.all(
        [...collectArtifactPaths(detail), ...tempPaths].map(async (artifactPath) => {
          try {
            await fs.rm(artifactPath, { force: true })
          } catch {
            return
          }
        })
      )
      return { success: true, job: completedAttempt }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAttempt: CommitAttempt = {
        ...attempt,
        status: 'failed',
        completed_at: Date.now(),
        error: message
      }
      await this.replaceCommitAttempt(request.reviewId, failedAttempt)
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
      return { success: false, job: failedAttempt, error: message }
    }
  }

  private async validateReview(review: FileReview): Promise<CommitValidationIssue[]> {
    const issues: CommitValidationIssue[] = []
    const draftPath = getDraftArtifactPath(review)
    const workingPath = getWorkingArtifactPath(review)
    const committedPath = getCommittedArtifactPath(review)

    if (!draftPath) {
      issues.push({
        code: 'review_artifact_missing',
        message: '审阅稿不存在，无法提交。',
        sourcePath: review.source_path
      })
      return issues
    }

    if (!(await fileExists(draftPath))) {
      issues.push({
        code: 'review_artifact_missing',
        message: '审阅稿已丢失，需要重新生成。',
        sourcePath: review.source_path
      })
      return issues
    }

    if (!workingPath || !(await fileExists(workingPath))) {
      issues.push({
        code: 'working_artifact_missing',
        message: '当前工作稿已丢失，需要重新生成。',
        sourcePath: review.source_path
      })
      return issues
    }

    if (!committedPath || !(await fileExists(committedPath))) {
      issues.push({
        code: 'committed_artifact_missing',
        message: '最终提交稿已丢失，需要重新生成。',
        sourcePath: review.source_path
      })
      return issues
    }

    const fresh = await isSourceVersionFresh(review.source_path, review.source_version)
    if (!fresh) {
      issues.push({
        code: 'source_changed',
        message: '源文件已发生变化，无法基于旧审阅稿直接替换。',
        sourcePath: review.source_path
      })
    }
    return issues
  }

  private async handleValidationFailure(input: {
    request: CommitFileReviewRequest
    review: FileReview
    issues: CommitValidationIssue[]
  }): Promise<CommitFileReviewResponse> {
    const hasConflict = input.issues.some((issue) => issue.code === 'source_changed')
    const now = Date.now()
    const errorMessage = input.issues.map((issue) => issue.message).join('；')
    let conflictAttempt: CommitAttempt | undefined

    if (hasConflict) {
      conflictAttempt = {
        id: randomUUID(),
        review_id: input.request.reviewId,
        status: 'conflicted',
        results: [],
        started_at: now,
        completed_at: now,
        error: errorMessage
      }
      await this.appendCommitAttempt(input.request.reviewId, conflictAttempt)
      await this.updateReviewSummary({
        ...input.review,
        status: 'conflicted',
        updated_at: now,
        last_error: errorMessage
      })
    }

    return { success: false, job: conflictAttempt, error: errorMessage }
  }

  private async appendCommitAttempt(reviewId: string, nextAttempt: CommitAttempt): Promise<void> {
    const attempts = await this.fileReviewStore.listCommitAttempts(reviewId)
    await this.fileReviewStore.replaceCommitAttempts(reviewId, [...attempts, nextAttempt])
  }

  private async replaceCommitAttempt(reviewId: string, nextAttempt: CommitAttempt): Promise<void> {
    const attempts = await this.fileReviewStore.listCommitAttempts(reviewId)
    const filtered = attempts.filter((attempt) => attempt.id !== nextAttempt.id)
    await this.fileReviewStore.replaceCommitAttempts(reviewId, [...filtered, nextAttempt])
  }

  private async updateReviewSummary(review: FileReview): Promise<void> {
    await this.fileReviewStore.saveReview(review)
  }
}
