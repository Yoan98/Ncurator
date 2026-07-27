import type {
  AiFileChangeCapability,
  AiFileChangeOperation,
  AiFileChangeRecord,
  AiFileChangeSource,
  AiFileChangeStatus,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildWhere,
  insertOrReplace,
  toOptionalString,
  toRequiredNumber,
  toRequiredString
} from '../sqlite/sqliteUtils'

type AiFileChangeRow = Record<string, unknown>

const normalizeStatus = (value: unknown): AiFileChangeStatus => {
  const normalized = String(value ?? '').trim()
  return normalized === 'reverted' || normalized === 'failed' ? normalized : 'applied'
}

const normalizeCapability = (value: unknown): AiFileChangeCapability => {
  const normalized = String(value ?? '').trim()
  if (
    normalized === 'text_file' ||
    normalized === 'terminal_exec' ||
    normalized === 'ppt' ||
    normalized === 'excel'
  ) {
    return normalized
  }
  return 'docx'
}

const normalizeOperation = (value: unknown): AiFileChangeOperation => {
  if (value === 'created' || value === 'deleted' || value === 'renamed') return value
  return 'updated'
}

const normalizeSource = (value: unknown): AiFileChangeSource | undefined => {
  if (
    value === 'workspace_scan' ||
    value === 'text_tool' ||
    value === 'docx_tool' ||
    value === 'ppt_tool' ||
    value === 'excel_tool'
  )
    return value
  return undefined
}

const toRecord = (row: AiFileChangeRow): AiFileChangeRecord => ({
  id: toRequiredString(row.id),
  sessionId: toRequiredString(row.session_id),
  runId: toRequiredString(row.run_id),
  status: normalizeStatus(row.status),
  capability: normalizeCapability(row.capability),
  path: toRequiredString(row.path),
  fileName: toRequiredString(row.file_name),
  operation: normalizeOperation(row.operation),
  source: normalizeSource(row.source),
  beforePath: toOptionalString(row.before_path),
  afterPath: toOptionalString(row.after_path),
  changeCount: toRequiredNumber(row.change_count),
  insertCount: toRequiredNumber(row.insert_count),
  deleteCount: toRequiredNumber(row.delete_count),
  beforeSnapshotPath: toOptionalString(row.before_snapshot_path),
  afterSnapshotPath: toOptionalString(row.after_snapshot_path),
  beforeObjectHash: toOptionalString(row.before_object_hash),
  afterObjectHash: toOptionalString(row.after_object_hash),
  previewArtifactHash: toOptionalString(row.preview_artifact_hash),
  beforeChecksum: toOptionalString(row.before_checksum),
  afterChecksum: toOptionalString(row.after_checksum),
  previewPath: toOptionalString(row.preview_path),
  runSummary: toOptionalString(row.run_summary),
  createdAt: toRequiredNumber(row.created_at),
  updatedAt: toRequiredNumber(row.updated_at),
  revertedAt: toRequiredNumber(row.reverted_at) || undefined,
  error: toOptionalString(row.last_error)
})

const toWriteRow = (record: AiFileChangeRecord) => ({
  id: record.id,
  session_id: record.sessionId,
  run_id: record.runId,
  status: record.status,
  capability: record.capability,
  path: record.path,
  file_name: record.fileName,
  operation: record.operation,
  source: record.source,
  before_path: record.beforePath,
  after_path: record.afterPath,
  change_count: record.changeCount,
  insert_count: record.insertCount,
  delete_count: record.deleteCount,
  before_snapshot_path: record.beforeSnapshotPath,
  after_snapshot_path: record.afterSnapshotPath,
  before_object_hash: record.beforeObjectHash,
  after_object_hash: record.afterObjectHash,
  preview_artifact_hash: record.previewArtifactHash,
  before_checksum: record.beforeChecksum,
  after_checksum: record.afterChecksum,
  preview_path: record.previewPath,
  run_summary: record.runSummary,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
  reverted_at: record.revertedAt,
  last_error: record.error
})

export class AiFileChangeStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveRecord(record: AiFileChangeRecord): Promise<void> {
    insertOrReplace(this.sqlite, 'ai_file_change', toWriteRow(record))
  }

  public async listRecords(
    filters?: ListAiFileChangeRecordsRequest
  ): Promise<ListAiFileChangeRecordsResponse> {
    const params = {
      session_id: filters?.sessionId || null,
      run_id: filters?.runId || null,
      status: filters?.status || null
    }
    const where = buildWhere([
      filters?.sessionId ? 'session_id = @session_id' : undefined,
      filters?.runId ? 'run_id = @run_id' : undefined,
      filters?.status ? 'status = @status' : undefined
    ])
    const rows = this.sqlite
      .prepare(`SELECT * FROM ai_file_change WHERE ${where} ORDER BY updated_at DESC`)
      .all(params) as AiFileChangeRow[]
    const items = rows.map(toRecord)
    return { items, total: items.length }
  }

  public async getRecord(
    request: GetAiFileChangeRecordRequest
  ): Promise<GetAiFileChangeRecordResponse> {
    const row = this.sqlite
      .prepare('SELECT * FROM ai_file_change WHERE id = ? LIMIT 1')
      .get(request.changeId) as AiFileChangeRow | undefined
    const record = row ? toRecord(row) : undefined
    return record ? { record } : { error: 'file change record not found' }
  }
}
