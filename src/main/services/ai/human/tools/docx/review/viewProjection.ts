import path from 'node:path'
import type { DraftReviewDocument } from '../../../../../../../shared/types'

const sanitizeProjectedFileName = (value: string): string => {
  const normalized = String(value || '').trim()
  const safe = normalized.replace(/[^\w.-]+/g, '-')
  return safe || 'document.docx'
}

export type DocxReviewArtifactPaths = {
  reviewArtifactPath: string
  workingArtifactPath: string
  manifestArtifactPath: string
}

export const buildDocxReviewArtifactPaths = (input: {
  workspaceRootPath: string
  reviewId: string
  documentIndex: number
  sourceName: string
}): DocxReviewArtifactPaths => {
  const draftDir = path.join(
    path.resolve(input.workspaceRootPath),
    '.ncurator',
    'draft-reviews',
    input.reviewId
  )
  const baseName = sanitizeProjectedFileName(input.sourceName)
  const reviewArtifactPath = path.join(
    draftDir,
    `${String(input.documentIndex + 1).padStart(2, '0')}-review-${baseName}`
  )
  const workingArtifactPath = path.join(
    draftDir,
    `${String(input.documentIndex + 1).padStart(2, '0')}-working-${baseName}`
  )
  return {
    reviewArtifactPath,
    workingArtifactPath,
    manifestArtifactPath: `${reviewArtifactPath}.manifest.json`
  }
}

export const getReviewArtifactPath = (
  document: Pick<DraftReviewDocument, 'review_artifact_path'>
): string | undefined => document.review_artifact_path

export const getWorkingArtifactPath = (
  document: Pick<DraftReviewDocument, 'working_artifact_path'>
): string | undefined => document.working_artifact_path
