import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DraftReviewStore } from '../../../src/main/services/storage/domains/DraftReviewStore'
import { materializeDocxConfirmCopy } from '../../../src/main/services/ai/human/tools/docx/review/confirmCopy'
import { buildSourceVersion } from '../../../src/main/services/ai/human/tools/docx/review/utils'
import { buildDocxReviewArtifactPaths } from '../../../src/main/services/ai/human/tools/docx/review/viewProjection'
import type { SeedDraftReviewInput } from './test-types'

export const seedDraftReview = async (input: {
  workspaceRoot: string
  draftReviewStore: DraftReviewStore
  payload: SeedDraftReviewInput
}): Promise<{ reviewId: string }> => {
  const reviewId = input.payload.reviewId || randomUUID()
  const createdAt = input.payload.createdAt || Date.now()
  const updatedAt = input.payload.updatedAt || createdAt
  const reviewArtifactsRoot = path.join(
    input.workspaceRoot,
    '.ncurator-test',
    'draft-reviews',
    reviewId
  )
  await fs.mkdir(reviewArtifactsRoot, { recursive: true })

  const documents = await Promise.all(
    input.payload.documents.map(async (document, index) => {
      const documentId = `${reviewId}-doc-${index + 1}`
      const sourceVersion = await buildSourceVersion(document.sourcePath)
      const confirmSourcePath = document.confirmBasePath || document.sourcePath
      const {
        reviewArtifactPath: confirmArtifactPath,
        workingArtifactPath: effectiveDraftArtifactPath,
        manifestArtifactPath
      } = buildDocxReviewArtifactPaths({
        workspaceRootPath: input.workspaceRoot,
        reviewId,
        documentIndex: index,
        sourceName: document.sourceName || path.basename(document.sourcePath)
      })
      await fs.mkdir(path.dirname(effectiveDraftArtifactPath), { recursive: true })
      await fs.copyFile(confirmSourcePath, effectiveDraftArtifactPath)

      await materializeDocxConfirmCopy({
        baseBuffer: await fs.readFile(confirmSourcePath),
        confirmArtifactPath,
        manifestArtifactPath,
        reviewId,
        sourcePath: document.sourcePath,
        sourceName: document.sourceName || path.basename(document.sourcePath),
        latestDraftSnapshotId: document.latestDraftSnapshotId || `${documentId}-snapshot`,
        sourceVersion,
        changes: [],
        createdAt
      })

      return {
        id: documentId,
        review_id: reviewId,
        source_document_id: document.sourceDocumentId,
        source_path: document.sourcePath,
        source_name: document.sourceName || path.basename(document.sourcePath),
        format: document.format || 'docx',
        latest_draft_snapshot_id: document.latestDraftSnapshotId || `${documentId}-snapshot`,
        review_artifact_path: confirmArtifactPath,
        working_artifact_path: effectiveDraftArtifactPath,
        source_version: sourceVersion,
        total_change_count: 0,
        pending_change_count: 0,
        accepted_change_count: 0,
        rejected_change_count: 0,
        created_at: createdAt,
        updated_at: updatedAt
      }
    })
  )

  await input.draftReviewStore.saveReviewDetail({
    review: {
      id: reviewId,
      session_id: input.payload.sessionId || 'test-session',
      run_id: input.payload.runId || 'test-run',
      status: input.payload.status || 'pending_confirm',
      title: input.payload.title || 'Test Draft Review',
      document_count: documents.length,
      change_count: 0,
      pending_change_count: 0,
      accepted_change_count: 0,
      rejected_change_count: 0,
      created_at: createdAt,
      updated_at: updatedAt
    },
    documents,
    changes: [],
    commit_jobs: []
  })

  return { reviewId }
}
