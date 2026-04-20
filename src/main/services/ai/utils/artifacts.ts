import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiDraftReviewArtifactRef,
  AiFileArtifactOperation,
  AiFileArtifactRef,
  AiRunEvent,
  DraftReviewDetail,
  JsonObject,
  JsonValue
} from '../../../../shared/types'
import type { ToolCallResult } from '../human/types'
import { getReviewArtifactPath } from '../human/tools/docx/review/viewProjection'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

const readNonEmptyString = (input: JsonObject, key: string): string | undefined => {
  const value = input[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const readArtifactOperation = (
  input: JsonObject,
  key: string,
  fallback: AiFileArtifactOperation
): AiFileArtifactOperation => {
  const value = input[key]
  return value === 'created' || value === 'updated' ? value : fallback
}

const createFileArtifactRef = (input: {
  capability: AiFileArtifactRef['capability']
  artifactPath: string
  operation: AiFileArtifactOperation
  summary: string
  artifactRole?: AiFileArtifactRef['artifactRole']
  reviewId?: string
  draftDocumentId?: string
  draftSnapshotId?: string
}): AiFileArtifactRef => ({
  kind: 'file',
  capability: input.capability,
  path: input.artifactPath,
  fileName: path.basename(input.artifactPath),
  operation: input.operation,
  artifactRole: input.artifactRole,
  reviewId: input.reviewId,
  draftDocumentId: input.draftDocumentId,
  draftSnapshotId: input.draftSnapshotId,
  summary: input.summary
})

const extractTerminalArtifacts = (result: ToolCallResult): AiArtifactRef[] => {
  if (result.toolName !== 'workspace_run_command' || !isJsonObject(result.data)) return []
  const rawArtifacts = result.data.artifacts
  if (!Array.isArray(rawArtifacts)) return []
  return rawArtifacts.flatMap((item) => {
    if (!isJsonObject(item)) return []
    const artifactPath = readNonEmptyString(item, 'path')
    if (!artifactPath) return []
    return [
      createFileArtifactRef({
        capability: 'terminal_exec',
        artifactPath,
        operation: readArtifactOperation(item, 'operation', 'created'),
        summary:
          readNonEmptyString(item, 'summary') ||
          `terminal command produced/updated file: ${path.basename(artifactPath)}`
      })
    ]
  })
}

const getArtifactKey = (artifact: AiArtifactRef): string =>
  artifact.kind === 'file'
    ? `file:${artifact.path}`
    : `draft_review:${artifact.review.reviewId}`

export const mergeArtifactRefs = (
  ...groups: Array<readonly AiArtifactRef[] | undefined>
): AiArtifactRef[] => {
  const merged = new Map<string, AiArtifactRef>()
  groups.forEach((group) => {
    group?.forEach((artifact) => {
      const key = getArtifactKey(artifact)
      if (merged.has(key)) {
        merged.delete(key)
      }
      merged.set(key, artifact)
    })
  })
  return Array.from(merged.values())
}

export const extractArtifactRefsFromToolResult = (result: ToolCallResult): AiArtifactRef[] =>
  mergeArtifactRefs(extractTerminalArtifacts(result))

export const extractArtifactRefsFromToolResults = (
  results: readonly ToolCallResult[]
): AiArtifactRef[] =>
  mergeArtifactRefs(...results.map((result) => extractArtifactRefsFromToolResult(result)))

export const buildRunArtifactsFromDraftReviewDetail = (
  detail: DraftReviewDetail
): AiArtifactRef[] => {
  const draftReviewArtifact: AiDraftReviewArtifactRef = {
    kind: 'draft_review',
    review: {
      reviewId: detail.review.id,
      documentCount: detail.review.document_count,
      changeCount: detail.review.change_count
    },
    summary: `review document ready (${detail.review.document_count} docs, ${detail.review.change_count} changes)`
  }

  const draftArtifacts = detail.documents.flatMap((document) => {
    const reviewArtifactPath = getReviewArtifactPath(document)
    if (!reviewArtifactPath) return []
    return [
      createFileArtifactRef({
        capability: 'docx',
        artifactPath: reviewArtifactPath,
        operation: 'created',
        artifactRole: 'draft',
        reviewId: detail.review.id,
        draftDocumentId: document.id,
        draftSnapshotId: document.latest_draft_snapshot_id,
        summary: `review doc ready: ${document.source_name}`
      })
    ]
  })

  return mergeArtifactRefs([draftReviewArtifact], draftArtifacts)
}

export const appendDraftReviewArtifactsAndEmitEvents = (input: {
  existingArtifacts?: readonly AiArtifactRef[]
  details: readonly DraftReviewDetail[]
  sendEvent: (event: AiRunEvent) => void
  runId: string
  taskId: string
}): AiArtifactRef[] => {
  const nextArtifacts = mergeArtifactRefs(
    input.existingArtifacts,
    ...input.details.map((detail) => buildRunArtifactsFromDraftReviewDetail(detail))
  )

  input.details.forEach((detail) => {
    input.sendEvent({
      type: 'draft_review_ready',
      runId: input.runId,
      review: {
        reviewId: detail.review.id,
        documentCount: detail.review.document_count,
        changeCount: detail.review.change_count
      },
      createdAt: Date.now()
    })

    detail.documents.forEach((document) => {
      const reviewArtifactPath = getReviewArtifactPath(document)
      if (!reviewArtifactPath) return
      input.sendEvent({
        type: 'file_artifact',
        runId: input.runId,
        taskId: input.taskId,
        artifactId: uuidv4(),
        capability: 'docx',
        path: reviewArtifactPath,
        fileName: path.basename(reviewArtifactPath),
        operation: 'created',
        artifactRole: 'draft',
        reviewId: detail.review.id,
        draftDocumentId: document.id,
        draftSnapshotId: document.latest_draft_snapshot_id,
        summary: `review doc ready: ${document.source_name}`,
        createdAt: Date.now()
      })
    })
  })

  return nextArtifacts
}
