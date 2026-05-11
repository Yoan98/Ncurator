import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiFileArtifactOperation,
  AiFileArtifactRef,
  AiFileReviewArtifactRef,
  AiRunEvent,
  FileReviewDetail,
  JsonObject,
  JsonValue,
  RuntimeArtifactsSummary
} from '../../../../shared/types'
import type { ToolCallResult } from '../human/types'

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
  draftSnapshotId?: string
}): AiFileArtifactRef => ({
  kind: 'file',
  capability: input.capability,
  path: input.artifactPath,
  fileName: path.basename(input.artifactPath),
  operation: input.operation,
  artifactRole: input.artifactRole,
  reviewId: input.reviewId,
  draftSnapshotId: input.draftSnapshotId,
  summary: input.summary
})

const extractTerminalArtifacts = (result: ToolCallResult): AiArtifactRef[] => {
  if (result.toolName !== 'terminal_run' || !isJsonObject(result.data)) return []
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
      if (merged.has(key)) merged.delete(key)
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

export const buildRunArtifactsFromFileReviewDetail = (detail: FileReviewDetail): AiArtifactRef[] => {
  const reviewArtifact: AiFileReviewArtifactRef = {
    kind: 'draft_review',
    review: {
      reviewId: detail.review.id,
      changeCount: detail.review.change_count
    },
    summary: `review document ready (1 doc, ${detail.review.change_count} changes)`
  }

  const draftArtifacts = detail.review.draft_artifact_path
    ? [
        createFileArtifactRef({
          capability: 'docx',
          artifactPath: detail.review.draft_artifact_path,
          operation: 'created',
          artifactRole: 'draft',
          reviewId: detail.review.id,
          draftSnapshotId: detail.review.latest_draft_snapshot_id,
          summary: `review doc ready: ${detail.review.source_name}`
        })
      ]
    : []

  return mergeArtifactRefs([reviewArtifact], draftArtifacts)
}

export const appendFileReviewArtifactsAndEmitEvents = (input: {
  existingArtifacts?: readonly AiArtifactRef[]
  details: readonly FileReviewDetail[]
  sendEvent: (event: AiRunEvent) => void
  runId: string
  taskId: string
}): AiArtifactRef[] => {
  const nextArtifacts = mergeArtifactRefs(
    input.existingArtifacts,
    ...input.details.map((detail) => buildRunArtifactsFromFileReviewDetail(detail))
  )

  input.details.forEach((detail) => {
    input.sendEvent({
      type: 'draft_review_ready',
      runId: input.runId,
      review: {
        reviewId: detail.review.id,
        changeCount: detail.review.change_count
      },
      createdAt: Date.now()
    })

    if (!detail.review.draft_artifact_path) return
    input.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.taskId,
      artifactId: uuidv4(),
      capability: 'docx',
      path: detail.review.draft_artifact_path,
      fileName: path.basename(detail.review.draft_artifact_path),
      operation: 'created',
      artifactRole: 'draft',
      reviewId: detail.review.id,
      draftSnapshotId: detail.review.latest_draft_snapshot_id,
      summary: `review doc ready: ${detail.review.source_name}`,
      createdAt: Date.now()
    })
  })

  return nextArtifacts
}

/**
 * RuntimeArtifactsSummary is only for mouth consumption. It intentionally
 * exposes user-facing changed-file facts instead of internal artifact wiring.
 */
export const buildRuntimeArtifactsSummaryFromFileReviewDetails = (
  details: readonly FileReviewDetail[]
): RuntimeArtifactsSummary => ({
  changed_files: details.map((detail) => ({
    file_name: detail.review.source_name,
    source_path: detail.review.source_path,
    format: 'docx',
    change_count: detail.review.change_count,
    summary:
      detail.changes[0]?.summary ||
      (detail.review.change_count > 0
        ? `已生成 ${detail.review.change_count} 处文档修改`
        : '已生成待确认稿'),
    change_highlights: detail.changes.map((change) => change.title).filter(Boolean),
    draft_artifact_path: detail.review.draft_artifact_path
  }))
})
