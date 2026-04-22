import path from 'node:path'
import type { FileReview } from '../../../../../../../shared/types'

const sanitizeProjectedFileName = (value: string): string => {
  const normalized = String(value || '').trim()
  const safe = normalized.replace(/[^\w.-]+/g, '-')
  return safe || 'document.docx'
}

export type DocxReviewArtifactPaths = {
  draftArtifactPath: string
  workingArtifactPath: string
  committedArtifactPath: string
}

export const buildDocxReviewArtifactPaths = (input: {
  workspaceRootPath: string
  reviewId: string
  sourceName: string
}): DocxReviewArtifactPaths => {
  const reviewDir = path.join(
    path.resolve(input.workspaceRootPath),
    '.ncurator',
    'file-reviews',
    input.reviewId
  )
  const baseName = sanitizeProjectedFileName(input.sourceName)
  return {
    draftArtifactPath: path.join(reviewDir, `draft-${baseName}`),
    workingArtifactPath: path.join(reviewDir, `working-${baseName}`),
    committedArtifactPath: path.join(reviewDir, `committed-${baseName}`)
  }
}

export const getDraftArtifactPath = (
  review: Pick<FileReview, 'draft_artifact_path'>
): string | undefined => review.draft_artifact_path

export const getWorkingArtifactPath = (
  review: Pick<FileReview, 'working_artifact_path'>
): string | undefined => review.working_artifact_path

export const getCommittedArtifactPath = (
  review: Pick<FileReview, 'committed_artifact_path'>
): string | undefined => review.committed_artifact_path
