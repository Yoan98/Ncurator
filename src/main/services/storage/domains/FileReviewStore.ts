import type {
  CommitAttempt,
  CommitAttemptStatus,
  CommitResultItem,
  DraftChangeDecision,
  DraftSourceVersion,
  FileReview,
  FileReviewChange,
  FileReviewStatus,
  JsonObject,
  JsonValue,
  ListFileReviewsRequest,
  ListFileReviewsResponse,
} from '../../../types/store'
import type { DraftTextDiffHunk } from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type DraftTextDiffHunkLineType = DraftTextDiffHunk['lines'][number]['type']

const normalizeDiffHunkLineType = (value: JsonValue | undefined): DraftTextDiffHunkLineType => {
  return value === 'added' || value === 'removed' || value === 'context' ? value : 'context'
}

type PrimitiveRowValue = string | number | boolean | null | undefined
type WriteRow = Record<string, PrimitiveRowValue>

type FileReviewRow = {
  id?: PrimitiveRowValue
  session_id?: PrimitiveRowValue
  run_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  title?: PrimitiveRowValue
  source_document_id?: PrimitiveRowValue
  source_path?: PrimitiveRowValue
  source_name?: PrimitiveRowValue
  output_operation?: PrimitiveRowValue
  format?: PrimitiveRowValue
  review_render_kind?: PrimitiveRowValue
  latest_draft_snapshot_id?: PrimitiveRowValue
  draft_artifact_path?: PrimitiveRowValue
  working_artifact_path?: PrimitiveRowValue
  committed_artifact_path?: PrimitiveRowValue
  source_version_json?: PrimitiveRowValue
  change_count?: PrimitiveRowValue
  pending_change_count?: PrimitiveRowValue
  accepted_change_count?: PrimitiveRowValue
  rejected_change_count?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
  completed_at?: PrimitiveRowValue
  committed_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
}

type FileReviewChangeRow = {
  id?: PrimitiveRowValue
  review_id?: PrimitiveRowValue
  order_index?: PrimitiveRowValue
  change_kind?: PrimitiveRowValue
  title?: PrimitiveRowValue
  summary?: PrimitiveRowValue
  decision?: PrimitiveRowValue
  before_text?: PrimitiveRowValue
  after_text?: PrimitiveRowValue
  anchor_name?: PrimitiveRowValue
  locator_json?: PrimitiveRowValue
  diff_hunks_json?: PrimitiveRowValue
  source_step_ref?: PrimitiveRowValue
  metadata_json?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

type CommitAttemptRow = {
  id?: PrimitiveRowValue
  review_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  results_json?: PrimitiveRowValue
  started_at?: PrimitiveRowValue
  completed_at?: PrimitiveRowValue
  error?: PrimitiveRowValue
}

const toOptionalString = (value: PrimitiveRowValue): string | undefined => {
  if (value == null) return undefined
  const next = String(value).trim()
  return next.length > 0 ? next : undefined
}

const toRequiredString = (value: PrimitiveRowValue): string => String(value ?? '')

const toOptionalNumber = (value: PrimitiveRowValue): number | undefined => {
  if (value == null) return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

const toRequiredNumber = (value: PrimitiveRowValue, fallback = 0): number => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

const parseJsonValue = (value: PrimitiveRowValue): JsonValue | undefined => {
  const raw = toOptionalString(value)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as JsonValue
  } catch {
    return undefined
  }
}

const parseJsonObject = (value: PrimitiveRowValue): JsonObject | undefined => {
  const parsed = parseJsonValue(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed
}

const parseSourceVersion = (value: PrimitiveRowValue): DraftSourceVersion => {
  const parsed = parseJsonObject(value)
  if (!parsed) return { exists: true }
  return {
    exists: typeof parsed.exists === 'boolean' ? parsed.exists : true,
    mtime_ms: typeof parsed.mtime_ms === 'number' ? parsed.mtime_ms : undefined,
    byte_size: typeof parsed.byte_size === 'number' ? parsed.byte_size : undefined,
    checksum: typeof parsed.checksum === 'string' ? parsed.checksum : undefined,
    content_hash: typeof parsed.content_hash === 'string' ? parsed.content_hash : undefined
  }
}

const parseDiffHunks = (value: PrimitiveRowValue): DraftTextDiffHunk[] | undefined => {
  const parsed = parseJsonValue(value)
  if (!Array.isArray(parsed)) return undefined
  return parsed
    .filter(
      (item): item is JsonObject =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    .map((item) => {
      const lines = Array.isArray(item.lines)
        ? item.lines
            .filter(
              (line): line is JsonObject =>
                Boolean(line) && typeof line === 'object' && !Array.isArray(line)
            )
            .map((line) => ({
              type: normalizeDiffHunkLineType(line.type),
              value: typeof line.value === 'string' ? line.value : ''
            }))
        : []
      return {
        id: typeof item.id === 'string' ? item.id : '',
        title: typeof item.title === 'string' ? item.title : undefined,
        summary: typeof item.summary === 'string' ? item.summary : undefined,
        lines
      }
    })
    .filter((item) => item.id && item.lines.length > 0)
}

const parseCommitResults = (value: PrimitiveRowValue): CommitResultItem[] => {
  const parsed = parseJsonValue(value)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (item): item is JsonObject =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    .map<CommitResultItem>((item) => {
      const operation: CommitResultItem['operation'] =
        item.operation === 'updated' ? 'updated' : 'created'
      return {
        review_id: typeof item.review_id === 'string' ? item.review_id : '',
        output_path: typeof item.output_path === 'string' ? item.output_path : '',
        operation,
        checksum: typeof item.checksum === 'string' ? item.checksum : undefined,
        byte_size: typeof item.byte_size === 'number' ? item.byte_size : undefined
      }
    })
    .filter((item) => item.review_id && item.output_path)
}

const normalizeFileReviewStatus = (value: PrimitiveRowValue): FileReviewStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'pending_confirm':
    case 'committing':
    case 'committed':
    case 'conflicted':
    case 'discarded':
    case 'superseded':
    case 'failed':
      return normalized
    default:
      return 'pending_confirm'
  }
}

const normalizeChangeDecision = (value: PrimitiveRowValue): DraftChangeDecision => {
  const normalized = String(value ?? '').trim()
  return normalized === 'accepted' || normalized === 'rejected' ? normalized : 'pending'
}

const normalizeFormat = (value: PrimitiveRowValue): FileReview['format'] => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'pdf':
    case 'xlsx':
    case 'pptx':
    case 'md':
    case 'txt':
      return normalized
    default:
      return 'docx'
  }
}

const normalizeOutputOperation = (value: PrimitiveRowValue): FileReview['output_operation'] => {
  return value === 'created' ? 'created' : 'updated'
}

const normalizeChangeKind = (value: PrimitiveRowValue): FileReviewChange['change_kind'] => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'text_hunk':
    case 'table_cell':
    case 'worksheet_range':
    case 'slide_object':
    case 'page_region':
      return normalized
    default:
      return 'block'
  }
}

const normalizeCommitAttemptStatus = (value: PrimitiveRowValue): CommitAttemptStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'running':
    case 'completed':
    case 'failed':
    case 'conflicted':
      return normalized
    default:
      return 'pending'
  }
}

const toFileReview = (row: FileReviewRow): FileReview => ({
  id: toRequiredString(row.id),
  session_id: toRequiredString(row.session_id),
  run_id: toRequiredString(row.run_id),
  status: normalizeFileReviewStatus(row.status),
  title: toRequiredString(row.title),
  source_document_id: toOptionalString(row.source_document_id),
  source_path: toRequiredString(row.source_path),
  source_name: toRequiredString(row.source_name),
  output_operation: normalizeOutputOperation(row.output_operation),
  format: normalizeFormat(row.format),
  review_render_kind:
    row.review_render_kind === 'text_hunk' || row.review_render_kind === 'preview_only'
      ? row.review_render_kind
      : row.review_render_kind === 'sheet_range' || row.review_render_kind === 'slide_element'
        ? row.review_render_kind
        : 'docx_block',
  latest_draft_snapshot_id: toRequiredString(row.latest_draft_snapshot_id),
  draft_artifact_path: toOptionalString(row.draft_artifact_path),
  working_artifact_path: toOptionalString(row.working_artifact_path),
  committed_artifact_path: toOptionalString(row.committed_artifact_path),
  source_version: parseSourceVersion(row.source_version_json),
  change_count: toRequiredNumber(row.change_count),
  pending_change_count: toRequiredNumber(row.pending_change_count),
  accepted_change_count: toRequiredNumber(row.accepted_change_count),
  rejected_change_count: toRequiredNumber(row.rejected_change_count),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at),
  completed_at: toOptionalNumber(row.completed_at),
  committed_at: toOptionalNumber(row.committed_at),
  last_error: toOptionalString(row.last_error)
})

const toFileReviewChange = (row: FileReviewChangeRow): FileReviewChange => ({
  id: toRequiredString(row.id),
  review_id: toRequiredString(row.review_id),
  order_index: toRequiredNumber(row.order_index),
  change_kind: normalizeChangeKind(row.change_kind),
  title: toRequiredString(row.title),
  summary: toRequiredString(row.summary),
  decision: normalizeChangeDecision(row.decision),
  before_text: toOptionalString(row.before_text),
  after_text: toOptionalString(row.after_text),
  anchor_name: toOptionalString(row.anchor_name),
  locator: parseJsonObject(row.locator_json),
  diff_hunks: parseDiffHunks(row.diff_hunks_json),
  source_step_ref: toOptionalString(row.source_step_ref),
  metadata: parseJsonObject(row.metadata_json),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const toCommitAttempt = (row: CommitAttemptRow): CommitAttempt => ({
  id: toRequiredString(row.id),
  review_id: toRequiredString(row.review_id),
  status: normalizeCommitAttemptStatus(row.status),
  results: parseCommitResults(row.results_json),
  started_at: toRequiredNumber(row.started_at),
  completed_at: toOptionalNumber(row.completed_at),
  error: toOptionalString(row.error)
})

const omitUndefined = <T extends WriteRow>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) next[key] = value[key]
  }
  return next
}

const toFileReviewWriteRow = (review: FileReview): WriteRow => ({
  id: review.id,
  session_id: review.session_id,
  run_id: review.run_id,
  status: review.status,
  title: review.title,
  source_document_id: review.source_document_id,
  source_path: review.source_path,
  source_name: review.source_name,
  output_operation: review.output_operation,
  format: review.format,
  review_render_kind: review.review_render_kind,
  latest_draft_snapshot_id: review.latest_draft_snapshot_id,
  draft_artifact_path: review.draft_artifact_path,
  working_artifact_path: review.working_artifact_path,
  committed_artifact_path: review.committed_artifact_path,
  source_version_json: JSON.stringify(review.source_version),
  change_count: review.change_count,
  pending_change_count: review.pending_change_count,
  accepted_change_count: review.accepted_change_count,
  rejected_change_count: review.rejected_change_count,
  created_at: review.created_at,
  updated_at: review.updated_at,
  completed_at: review.completed_at,
  committed_at: review.committed_at,
  last_error: review.last_error
})

const toFileReviewChangeWriteRow = (change: FileReviewChange): WriteRow => ({
  id: change.id,
  review_id: change.review_id,
  order_index: change.order_index,
  change_kind: change.change_kind,
  title: change.title,
  summary: change.summary,
  decision: change.decision,
  before_text: change.before_text,
  after_text: change.after_text,
  anchor_name: change.anchor_name,
  locator_json: change.locator ? JSON.stringify(change.locator) : undefined,
  diff_hunks_json: change.diff_hunks ? JSON.stringify(change.diff_hunks) : undefined,
  source_step_ref: change.source_step_ref,
  metadata_json: change.metadata ? JSON.stringify(change.metadata) : undefined,
  created_at: change.created_at,
  updated_at: change.updated_at
})

const toCommitAttemptWriteRow = (attempt: CommitAttempt): WriteRow => ({
  id: attempt.id,
  review_id: attempt.review_id,
  status: attempt.status,
  results_json: JSON.stringify(attempt.results),
  started_at: attempt.started_at,
  completed_at: attempt.completed_at,
  error: attempt.error
})

export class FileReviewStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveReview(review: FileReview): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW)
    await table.delete(`id = '${this.core.escapeSqlString(review.id)}'`)
    await table.add([omitUndefined(toFileReviewWriteRow(review))])
  }

  public async listReviews(filters?: ListFileReviewsRequest): Promise<ListFileReviewsResponse> {
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW)
    const where = this.core.combineWhere([
      filters?.sessionId ? `session_id = '${this.core.escapeSqlString(filters.sessionId)}'` : undefined,
      filters?.status ? `status = '${this.core.escapeSqlString(filters.status)}'` : undefined
    ])
    const rows = (await (where ? table.query().where(where) : table.query()).toArray()) as FileReviewRow[]
    const items = rows.map(toFileReview).sort((a, b) => b.updated_at - a.updated_at)
    return { items, total: items.length }
  }

  public async getReview(reviewId: string): Promise<FileReview | null> {
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(reviewId)}'`)
      .limit(1)
      .toArray()) as FileReviewRow[]
    return rows[0] ? toFileReview(rows[0]) : null
  }

  public async replaceChanges(reviewId: string, changes: FileReviewChange[]): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW_CHANGE)
    await table.delete(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
    if (changes.length === 0) return
    await table.add(changes.map((change) => omitUndefined(toFileReviewChangeWriteRow(change))))
  }

  public async listChanges(reviewId: string): Promise<FileReviewChange[]> {
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW_CHANGE)
    const rows = (await table
      .query()
      .where(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
      .toArray()) as FileReviewChangeRow[]
    return rows.map(toFileReviewChange).sort((a, b) => a.order_index - b.order_index)
  }

  public async replaceCommitAttempts(reviewId: string, attempts: CommitAttempt[]): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.COMMIT_ATTEMPT)
    await table.delete(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
    if (attempts.length === 0) return
    await table.add(attempts.map((attempt) => omitUndefined(toCommitAttemptWriteRow(attempt))))
  }

  public async listCommitAttempts(reviewId: string): Promise<CommitAttempt[]> {
    const table = await this.core.openTable(LANCE_TABLES.COMMIT_ATTEMPT)
    const rows = (await table
      .query()
      .where(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
      .toArray()) as CommitAttemptRow[]
    return rows.map(toCommitAttempt).sort((a, b) => a.started_at - b.started_at)
  }

  public async saveReviewDetail(detail: { review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] }): Promise<void> {
    await this.saveReview(detail.review)
    await this.replaceChanges(detail.review.id, detail.changes)
    await this.replaceCommitAttempts(detail.review.id, detail.commit_attempts)
  }

  public async getReviewDetail(reviewId: string): Promise<{ review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] } | null> {
    const review = await this.getReview(reviewId)
    if (!review) return null
    const [changes, commitAttempts] = await Promise.all([
      this.listChanges(reviewId),
      this.listCommitAttempts(reviewId)
    ])
    return {
      review,
      changes,
      commit_attempts: commitAttempts
    }
  }

  public async deleteReview(reviewId: string): Promise<void> {
    const safeReviewId = this.core.escapeSqlString(reviewId)
    const [reviewTable, changeTable, attemptTable] = await Promise.all([
      this.core.openTable(LANCE_TABLES.FILE_REVIEW),
      this.core.openTable(LANCE_TABLES.FILE_REVIEW_CHANGE),
      this.core.openTable(LANCE_TABLES.COMMIT_ATTEMPT)
    ])
    await reviewTable.delete(`id = '${safeReviewId}'`)
    await changeTable.delete(`review_id = '${safeReviewId}'`)
    await attemptTable.delete(`review_id = '${safeReviewId}'`)
  }

  public async listActiveReviewsBySourcePath(
    sourcePath: string,
    statuses: FileReviewStatus[]
  ): Promise<{ review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] }[]> {
    if (statuses.length === 0) return []
    const table = await this.core.openTable(LANCE_TABLES.FILE_REVIEW)
    const where = this.core.combineWhere([
      `source_path = '${this.core.escapeSqlString(sourcePath)}'`,
      this.core.buildInClause('status', statuses)
    ])
    const rows = (await table.query().where(where || '').toArray()) as FileReviewRow[]
    const reviewIds = rows.map((row) => toRequiredString(row.id)).filter(Boolean)
    const details = await Promise.all(reviewIds.map((reviewId) => this.getReviewDetail(reviewId)))
    return details
      .filter((detail): detail is { review: FileReview; changes: FileReviewChange[]; commit_attempts: CommitAttempt[] } => Boolean(detail))
      .sort((left, right) => right.review.updated_at - left.review.updated_at)
  }
}
