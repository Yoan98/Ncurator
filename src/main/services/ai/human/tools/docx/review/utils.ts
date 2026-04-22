import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import type {
  CommitAttempt,
  DraftSourceVersion,
  FileReview,
  FileReviewChange,
  FileReviewStatus,
  JsonObject
} from '../../../../../../../shared/types'
import { clipText } from '../../../../utils/text'
import type { DocxChangedBlock, DocxOp } from '../types'
import {
  getCommittedArtifactPath,
  getDraftArtifactPath,
  getWorkingArtifactPath
} from './viewProjection'

export const sanitizeFileName = (value: string): string => {
  const normalized = String(value || '').trim()
  const safe = normalized.replace(/[^\w.-]+/g, '-')
  return safe || 'document.docx'
}

export const describeDocxOp = (op: DocxOp): string => {
  switch (op.type) {
    case 'replace_block':
      return '替换块'
    case 'insert_after':
      return '后插入块'
    case 'insert_before':
      return '前插入块'
    case 'delete_block':
      return '删除块'
    case 'update_table_cell':
      return '更新表格单元格'
    case 'replace_text':
      return '替换文本'
    case 'style_text':
      return '更新文本样式'
  }
}

export const getDocxChangeKind = (op: DocxOp): FileReviewChange['change_kind'] =>
  op.type === 'update_table_cell' ? 'table_cell' : 'block'

export const buildDocxChangeTitle = (op: DocxOp, change: DocxChangedBlock): string => {
  const baseText = String(change.afterText || change.beforeText).trim()
  const previewRaw = clipText(baseText, 28).trim()
  const preview = previewRaw.length < baseText.length ? `${previewRaw}...` : previewRaw
  return preview ? `${describeDocxOp(op)}: ${preview}` : describeDocxOp(op)
}

export const buildDocxChangeSummary = (op: DocxOp, change: DocxChangedBlock): string =>
  `${describeDocxOp(op)} ${change.blockId}`

export const buildDocxChangeLocator = (change: DocxChangedBlock): JsonObject => ({
  blockId: change.blockId,
  action: change.action
})

export const toReviewStatus = (
  hasPending: boolean,
  previous?: FileReviewStatus
): FileReviewStatus => {
  if (previous === 'committing' || previous === 'committed') return previous
  if (
    previous === 'conflicted' ||
    previous === 'failed' ||
    previous === 'discarded' ||
    previous === 'superseded'
  ) {
    return previous
  }
  return hasPending ? 'pending_confirm' : 'pending_confirm'
}

export const buildSourceVersion = async (sourcePath: string): Promise<DraftSourceVersion> => {
  const stat = await fs.stat(sourcePath)
  const buffer = await fs.readFile(sourcePath)
  return {
    mtime_ms: stat.mtimeMs,
    byte_size: stat.size,
    checksum: createHash('sha256').update(buffer).digest('hex')
  }
}

export const isSourceVersionFresh = async (
  sourcePath: string,
  version: DraftSourceVersion
): Promise<boolean> => {
  try {
    const current = await buildSourceVersion(sourcePath)
    if (version.byte_size !== undefined && current.byte_size !== version.byte_size) return false
    if (version.mtime_ms !== undefined && current.mtime_ms !== version.mtime_ms) return false
    if (version.checksum && current.checksum !== version.checksum) return false
    if (version.content_hash && current.content_hash !== version.content_hash) return false
    return true
  } catch {
    return false
  }
}

export const parseDocxOpFromMetadata = (metadata?: JsonObject): DocxOp | null => {
  if (!metadata) return null
  const raw = metadata.docx_op_json
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as DocxOp
  } catch {
    return null
  }
}

export const getMetadataGroupId = (metadata?: JsonObject): string =>
  typeof metadata?.group_id === 'string' ? metadata.group_id : ''

export const collectArtifactPaths = (detail: { review: FileReview }): string[] => {
  const unique = new Set<string>()
  const draftArtifactPath = getDraftArtifactPath(detail.review)
  const workingArtifactPath = getWorkingArtifactPath(detail.review)
  const committedArtifactPath = getCommittedArtifactPath(detail.review)
  if (draftArtifactPath) unique.add(draftArtifactPath)
  if (workingArtifactPath) unique.add(workingArtifactPath)
  if (committedArtifactPath) unique.add(committedArtifactPath)
  return [...unique]
}

export const createArchivedCommittedDetail = (input: {
  detail: { review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] }
  completedAttempt: CommitAttempt
  committedAt: number
}): { review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] } => {
  const updatedAt = input.committedAt
  return {
    review: {
      ...input.detail.review,
      status: 'committed',
      committed_at: input.committedAt,
      updated_at: updatedAt,
      draft_artifact_path: undefined,
      working_artifact_path: undefined,
      committed_artifact_path: undefined,
      last_error: undefined
    },
    changes: input.detail.changes.map((change) => ({
      ...change,
      updated_at: updatedAt
    })),
    commit_attempts: [
      ...input.detail.commit_attempts.filter((attempt) => attempt.id !== input.completedAttempt.id),
      input.completedAttempt
    ]
  }
}
