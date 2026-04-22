import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileReviewStore } from '../../../src/main/services/storage/domains/FileReviewStore'
import { buildSourceVersion } from '../../../src/main/services/ai/human/tools/docx/review/utils'
import { buildDocxReviewArtifactPaths } from '../../../src/main/services/ai/human/tools/docx/review/viewProjection'
import type { SeedFileReviewInput } from './test-types'

export const seedFileReview = async (input: {
  workspaceRoot: string
  fileReviewStore: FileReviewStore
  payload: SeedFileReviewInput
}): Promise<{ reviewId: string }> => {
  const reviewId = input.payload.reviewId || randomUUID()
  const createdAt = input.payload.createdAt || Date.now()
  const updatedAt = input.payload.updatedAt || createdAt
  const document = input.payload.documents[0]
  if (!document) {
    throw new Error('seedFileReview requires one document payload')
  }

  const sourceVersion = await buildSourceVersion(document.sourcePath)
  const confirmSourcePath = document.confirmBasePath || document.sourcePath
  const { draftArtifactPath, workingArtifactPath, committedArtifactPath } =
    buildDocxReviewArtifactPaths({
      workspaceRootPath: input.workspaceRoot,
      reviewId,
      sourceName: document.sourceName || path.basename(document.sourcePath)
    })
  await fs.mkdir(path.dirname(workingArtifactPath), { recursive: true })
  await fs.copyFile(confirmSourcePath, workingArtifactPath)
  await fs.copyFile(confirmSourcePath, draftArtifactPath)
  await fs.copyFile(confirmSourcePath, committedArtifactPath)

  await input.fileReviewStore.saveReviewDetail({
    review: {
      id: reviewId,
      session_id: input.payload.sessionId || 'test-session',
      run_id: input.payload.runId || 'test-run',
      status: input.payload.status || 'pending_confirm',
      title: input.payload.title || 'Test File Review',
      source_document_id: document.sourceDocumentId,
      source_path: document.sourcePath,
      source_name: document.sourceName || path.basename(document.sourcePath),
      format: document.format || 'docx',
      review_render_kind: 'docx_block',
      latest_draft_snapshot_id: document.latestDraftSnapshotId || `${reviewId}-snapshot`,
      draft_artifact_path: draftArtifactPath,
      working_artifact_path: workingArtifactPath,
      committed_artifact_path: committedArtifactPath,
      source_version: sourceVersion,
      change_count: 0,
      pending_change_count: 0,
      accepted_change_count: 0,
      rejected_change_count: 0,
      created_at: createdAt,
      updated_at: updatedAt
    },
    changes: [],
    commit_attempts: []
  })

  return { reviewId }
}
