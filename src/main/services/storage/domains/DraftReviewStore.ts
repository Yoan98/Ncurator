import type {
  DraftChangeDecision,
  DraftCommitJob,
  DraftCommitResultItem,
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewStatus,
  DraftReviewSummary,
  DraftSourceVersion,
  JsonObject,
  JsonValue,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined

type DraftWriteRow = Record<string, PrimitiveRowValue>

type DraftReviewRow = {
  id?: PrimitiveRowValue
  session_id?: PrimitiveRowValue
  run_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  title?: PrimitiveRowValue
  document_count?: PrimitiveRowValue
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

type DraftReviewDocumentRow = {
  id?: PrimitiveRowValue
  review_id?: PrimitiveRowValue
  source_document_id?: PrimitiveRowValue
  source_path?: PrimitiveRowValue
  source_name?: PrimitiveRowValue
  format?: PrimitiveRowValue
  latest_draft_snapshot_id?: PrimitiveRowValue
  preview_artifact_path?: PrimitiveRowValue
  draft_artifact_path?: PrimitiveRowValue
  source_version_json?: PrimitiveRowValue
  total_change_count?: PrimitiveRowValue
  pending_change_count?: PrimitiveRowValue
  accepted_change_count?: PrimitiveRowValue
  rejected_change_count?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

type DraftReviewChangeRow = {
  id?: PrimitiveRowValue
  review_id?: PrimitiveRowValue
  document_id?: PrimitiveRowValue
  order_index?: PrimitiveRowValue
  change_kind?: PrimitiveRowValue
  title?: PrimitiveRowValue
  summary?: PrimitiveRowValue
  decision?: PrimitiveRowValue
  before_text?: PrimitiveRowValue
  after_text?: PrimitiveRowValue
  locator_json?: PrimitiveRowValue
  preview_artifact_path?: PrimitiveRowValue
  metadata_json?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

type DraftCommitJobRow = {
  id?: PrimitiveRowValue
  review_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  document_count?: PrimitiveRowValue
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
  } catch (error) {
    void error
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
  if (!parsed) return {}
  return {
    mtime_ms: typeof parsed.mtime_ms === 'number' ? parsed.mtime_ms : undefined,
    byte_size: typeof parsed.byte_size === 'number' ? parsed.byte_size : undefined,
    checksum: typeof parsed.checksum === 'string' ? parsed.checksum : undefined,
    content_hash: typeof parsed.content_hash === 'string' ? parsed.content_hash : undefined
  }
}

const parseCommitResults = (value: PrimitiveRowValue): DraftCommitResultItem[] => {
  const parsed = parseJsonValue(value)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (item): item is JsonObject =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    .map((item) => ({
      draft_document_id:
        typeof item.draft_document_id === 'string' ? item.draft_document_id : '',
      output_path: typeof item.output_path === 'string' ? item.output_path : '',
      operation: item.operation === 'updated' ? ('updated' as const) : ('created' as const),
      checksum: typeof item.checksum === 'string' ? item.checksum : undefined,
      byte_size: typeof item.byte_size === 'number' ? item.byte_size : undefined
    }))
    .filter((item) => item.draft_document_id && item.output_path)
}

const normalizeDraftReviewStatus = (value: PrimitiveRowValue): DraftReviewStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'commit_ready':
    case 'committing':
    case 'committed':
    case 'conflicted':
    case 'cancelled':
    case 'failed':
      return normalized
    default:
      return 'review_pending'
  }
}

const normalizeDraftChangeDecision = (value: PrimitiveRowValue): DraftChangeDecision => {
  const normalized = String(value ?? '').trim()
  if (normalized === 'accepted' || normalized === 'rejected') return normalized
  return 'pending'
}

const normalizeDraftDocumentFormat = (value: PrimitiveRowValue): DraftReviewDocument['format'] => {
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

const normalizeDraftChangeKind = (value: PrimitiveRowValue): DraftReviewChange['change_kind'] => {
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

const normalizeDraftCommitStatus = (value: PrimitiveRowValue): DraftCommitJob['status'] => {
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

const toDraftReviewSummary = (row: DraftReviewRow): DraftReviewSummary => ({
  id: toRequiredString(row.id),
  session_id: toRequiredString(row.session_id),
  run_id: toRequiredString(row.run_id),
  status: normalizeDraftReviewStatus(row.status),
  title: toRequiredString(row.title),
  document_count: toRequiredNumber(row.document_count),
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

const toDraftReviewDocument = (row: DraftReviewDocumentRow): DraftReviewDocument => ({
  id: toRequiredString(row.id),
  review_id: toRequiredString(row.review_id),
  source_document_id: toOptionalString(row.source_document_id),
  source_path: toRequiredString(row.source_path),
  source_name: toRequiredString(row.source_name),
  format: normalizeDraftDocumentFormat(row.format),
  latest_draft_snapshot_id: toRequiredString(row.latest_draft_snapshot_id),
  preview_artifact_path: toOptionalString(row.preview_artifact_path),
  draft_artifact_path: toOptionalString(row.draft_artifact_path),
  source_version: parseSourceVersion(row.source_version_json),
  total_change_count: toRequiredNumber(row.total_change_count),
  pending_change_count: toRequiredNumber(row.pending_change_count),
  accepted_change_count: toRequiredNumber(row.accepted_change_count),
  rejected_change_count: toRequiredNumber(row.rejected_change_count),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const toDraftReviewChange = (row: DraftReviewChangeRow): DraftReviewChange => ({
  id: toRequiredString(row.id),
  review_id: toRequiredString(row.review_id),
  document_id: toRequiredString(row.document_id),
  order_index: toRequiredNumber(row.order_index),
  change_kind: normalizeDraftChangeKind(row.change_kind),
  title: toRequiredString(row.title),
  summary: toRequiredString(row.summary),
  decision: normalizeDraftChangeDecision(row.decision),
  before_text: toRequiredString(row.before_text),
  after_text: toRequiredString(row.after_text),
  locator: parseJsonObject(row.locator_json) || {},
  preview_artifact_path: toOptionalString(row.preview_artifact_path),
  metadata: parseJsonObject(row.metadata_json),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const toDraftCommitJob = (row: DraftCommitJobRow): DraftCommitJob => ({
  id: toRequiredString(row.id),
  review_id: toRequiredString(row.review_id),
  status: normalizeDraftCommitStatus(row.status),
  document_count: toRequiredNumber(row.document_count),
  results: parseCommitResults(row.results_json),
  started_at: toRequiredNumber(row.started_at),
  completed_at: toOptionalNumber(row.completed_at),
  error: toOptionalString(row.error)
})

const omitUndefined = <T extends DraftWriteRow>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      next[key] = value[key]
    }
  }
  return next
}

const toDraftReviewWriteRow = (review: DraftReviewSummary): DraftWriteRow => ({
  id: review.id,
  session_id: review.session_id,
  run_id: review.run_id,
  status: review.status,
  title: review.title,
  document_count: review.document_count,
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

const toDraftReviewDocumentWriteRow = (document: DraftReviewDocument): DraftWriteRow => ({
  id: document.id,
  review_id: document.review_id,
  source_document_id: document.source_document_id,
  source_path: document.source_path,
  source_name: document.source_name,
  format: document.format,
  latest_draft_snapshot_id: document.latest_draft_snapshot_id,
  preview_artifact_path: document.preview_artifact_path,
  draft_artifact_path: document.draft_artifact_path,
  source_version_json: JSON.stringify(document.source_version),
  total_change_count: document.total_change_count,
  pending_change_count: document.pending_change_count,
  accepted_change_count: document.accepted_change_count,
  rejected_change_count: document.rejected_change_count,
  created_at: document.created_at,
  updated_at: document.updated_at
})

const toDraftReviewChangeWriteRow = (change: DraftReviewChange): DraftWriteRow => ({
  id: change.id,
  review_id: change.review_id,
  document_id: change.document_id,
  order_index: change.order_index,
  change_kind: change.change_kind,
  title: change.title,
  summary: change.summary,
  decision: change.decision,
  before_text: change.before_text,
  after_text: change.after_text,
  locator_json: JSON.stringify(change.locator),
  preview_artifact_path: change.preview_artifact_path,
  metadata_json: change.metadata ? JSON.stringify(change.metadata) : undefined,
  created_at: change.created_at,
  updated_at: change.updated_at
})

const toDraftCommitJobWriteRow = (job: DraftCommitJob): DraftWriteRow => ({
  id: job.id,
  review_id: job.review_id,
  status: job.status,
  document_count: job.document_count,
  results_json: JSON.stringify(job.results),
  started_at: job.started_at,
  completed_at: job.completed_at,
  error: job.error
})

export class DraftReviewStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveReview(review: DraftReviewSummary): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW)
    await table.delete(`id = '${this.core.escapeSqlString(review.id)}'`)
    await table.add([omitUndefined(toDraftReviewWriteRow(review))])
  }

  public async listReviews(filters?: ListDraftReviewsRequest): Promise<ListDraftReviewsResponse> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW)
    const where = this.core.combineWhere([
      filters?.sessionId
        ? `session_id = '${this.core.escapeSqlString(filters.sessionId)}'`
        : undefined,
      filters?.status ? `status = '${this.core.escapeSqlString(filters.status)}'` : undefined
    ])
    const rows = (await (where ? table.query().where(where) : table.query()).toArray()) as DraftReviewRow[]
    const items = rows.map(toDraftReviewSummary).sort((a, b) => b.updated_at - a.updated_at)
    return {
      items,
      total: items.length
    }
  }

  public async getReview(reviewId: string): Promise<DraftReviewSummary | null> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(reviewId)}'`)
      .limit(1)
      .toArray()) as DraftReviewRow[]
    const row = rows[0]
    return row ? toDraftReviewSummary(row) : null
  }

  public async replaceDocuments(reviewId: string, documents: DraftReviewDocument[]): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_DOCUMENT)
    await table.delete(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
    if (documents.length === 0) return
    await table.add(documents.map((document) => omitUndefined(toDraftReviewDocumentWriteRow(document))))
  }

  public async listDocuments(reviewId: string): Promise<DraftReviewDocument[]> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_DOCUMENT)
    const rows = (await table
      .query()
      .where(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
      .toArray()) as DraftReviewDocumentRow[]
    return rows.map(toDraftReviewDocument).sort((a, b) => a.created_at - b.created_at)
  }

  public async replaceChanges(reviewId: string, changes: DraftReviewChange[]): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_CHANGE)
    await table.delete(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
    if (changes.length === 0) return
    await table.add(changes.map((change) => omitUndefined(toDraftReviewChangeWriteRow(change))))
  }

  public async listChanges(reviewId: string): Promise<DraftReviewChange[]> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_CHANGE)
    const rows = (await table
      .query()
      .where(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
      .toArray()) as DraftReviewChangeRow[]
    return rows.map(toDraftReviewChange).sort((a, b) => a.order_index - b.order_index)
  }

  public async updateChangeDecision(
    reviewId: string,
    changeId: string,
    decision: DraftChangeDecision
  ): Promise<DraftReviewChange | null> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_CHANGE)
    const safeReviewId = this.core.escapeSqlString(reviewId)
    const safeChangeId = this.core.escapeSqlString(changeId)
    const rows = (await table
      .query()
      .where(`review_id = '${safeReviewId}' AND id = '${safeChangeId}'`)
      .limit(1)
      .toArray()) as DraftReviewChangeRow[]
    const row = rows[0]
    if (!row) return null
    const change = toDraftReviewChange(row)
    const next: DraftReviewChange = {
      ...change,
      decision,
      updated_at: Date.now()
    }
    await table.delete(`review_id = '${safeReviewId}' AND id = '${safeChangeId}'`)
    await table.add([omitUndefined(toDraftReviewChangeWriteRow(next))])
    return next
  }

  public async replaceCommitJobs(reviewId: string, jobs: DraftCommitJob[]): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_COMMIT_JOB)
    await table.delete(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
    if (jobs.length === 0) return
    await table.add(jobs.map((job) => omitUndefined(toDraftCommitJobWriteRow(job))))
  }

  public async listCommitJobs(reviewId: string): Promise<DraftCommitJob[]> {
    const table = await this.core.openTable(LANCE_TABLES.DRAFT_COMMIT_JOB)
    const rows = (await table
      .query()
      .where(`review_id = '${this.core.escapeSqlString(reviewId)}'`)
      .toArray()) as DraftCommitJobRow[]
    return rows.map(toDraftCommitJob).sort((a, b) => a.started_at - b.started_at)
  }

  public async saveReviewDetail(detail: DraftReviewDetail): Promise<void> {
    await this.saveReview(detail.review)
    await this.replaceDocuments(detail.review.id, detail.documents)
    await this.replaceChanges(detail.review.id, detail.changes)
    await this.replaceCommitJobs(detail.review.id, detail.commit_jobs)
  }

  public async getReviewDetail(reviewId: string): Promise<DraftReviewDetail | null> {
    const review = await this.getReview(reviewId)
    if (!review) return null
    const [documents, changes, commitJobs] = await Promise.all([
      this.listDocuments(reviewId),
      this.listChanges(reviewId),
      this.listCommitJobs(reviewId)
    ])
    return {
      review,
      documents,
      changes,
      commit_jobs: commitJobs
    }
  }

  public async deleteReview(reviewId: string): Promise<void> {
    const safeReviewId = this.core.escapeSqlString(reviewId)
    const [reviewTable, documentTable, changeTable, commitJobTable] = await Promise.all([
      this.core.openTable(LANCE_TABLES.DRAFT_REVIEW),
      this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_DOCUMENT),
      this.core.openTable(LANCE_TABLES.DRAFT_REVIEW_CHANGE),
      this.core.openTable(LANCE_TABLES.DRAFT_COMMIT_JOB)
    ])
    await reviewTable.delete(`id = '${safeReviewId}'`)
    await documentTable.delete(`review_id = '${safeReviewId}'`)
    await changeTable.delete(`review_id = '${safeReviewId}'`)
    await commitJobTable.delete(`review_id = '${safeReviewId}'`)
  }
}
