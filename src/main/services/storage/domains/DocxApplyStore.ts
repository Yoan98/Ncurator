import type {
  DocxApplyRecord,
  DocxApplyStatus,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildWhere,
  fromSqliteBoolean,
  insertOrReplace,
  toOptionalNumber,
  toOptionalString,
  toRequiredNumber,
  toRequiredString,
  updateById
} from '../sqlite/sqliteUtils'

type DocxApplyRow = Record<string, unknown>

const normalizeStatus = (value: unknown): DocxApplyStatus => {
  const normalized = String(value ?? '').trim()
  return normalized === 'reverted' || normalized === 'failed' ? normalized : 'applied'
}

const normalizeOperation = (value: unknown): DocxApplyRecord['operation'] =>
  value === 'created' ? 'created' : 'updated'

const toDocxApplyRecord = (row: DocxApplyRow): DocxApplyRecord => ({
  id: toRequiredString(row.id),
  partner_id: toRequiredString(row.partner_id),
  run_id: toRequiredString(row.run_id),
  status: normalizeStatus(row.status),
  source_path: toRequiredString(row.source_path),
  source_name: toRequiredString(row.source_name),
  operation: normalizeOperation(row.operation),
  final_revision_ref: toRequiredString(row.final_revision_ref),
  change_count: toRequiredNumber(row.change_count),
  insert_count: toRequiredNumber(row.insert_count),
  delete_count: toRequiredNumber(row.delete_count),
  before_exists: fromSqliteBoolean(row.before_exists),
  before_snapshot_path: toOptionalString(row.before_snapshot_path),
  before_checksum: toOptionalString(row.before_checksum),
  before_byte_size: toOptionalNumber(row.before_byte_size),
  before_modified_at: toOptionalNumber(row.before_modified_at),
  preview_diff_artifact_path: toRequiredString(row.preview_diff_artifact_path),
  preview_diff_checksum: toRequiredString(row.preview_diff_checksum),
  preview_diff_byte_size: toRequiredNumber(row.preview_diff_byte_size),
  after_checksum: toOptionalString(row.after_checksum),
  after_byte_size: toOptionalNumber(row.after_byte_size),
  after_modified_at: toOptionalNumber(row.after_modified_at),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at),
  reverted_at: toOptionalNumber(row.reverted_at),
  error: toOptionalString(row.last_error)
})

const toDocxApplyWriteRow = (record: DocxApplyRecord) => ({
  id: record.id,
  partner_id: record.partner_id,
  run_id: record.run_id,
  status: record.status,
  source_path: record.source_path,
  source_name: record.source_name,
  operation: record.operation,
  final_revision_ref: record.final_revision_ref,
  change_count: record.change_count,
  insert_count: record.insert_count,
  delete_count: record.delete_count,
  before_exists: record.before_exists ? 1 : 0,
  before_snapshot_path: record.before_snapshot_path,
  before_checksum: record.before_checksum,
  before_byte_size: record.before_byte_size,
  before_modified_at: record.before_modified_at,
  preview_diff_artifact_path: record.preview_diff_artifact_path,
  preview_diff_checksum: record.preview_diff_checksum,
  preview_diff_byte_size: record.preview_diff_byte_size,
  after_checksum: record.after_checksum,
  after_byte_size: record.after_byte_size,
  after_modified_at: record.after_modified_at,
  created_at: record.created_at,
  updated_at: record.updated_at,
  reverted_at: record.reverted_at,
  last_error: record.error
})

export class DocxApplyStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async removeRecord(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM docx_apply WHERE id = ?').run(id)
  }

  public async saveRecord(record: DocxApplyRecord): Promise<void> {
    insertOrReplace(this.sqlite, 'docx_apply', toDocxApplyWriteRow(record))
  }

  public async updateRecord(
    id: string,
    values: Partial<Pick<DocxApplyRecord, 'status' | 'updated_at' | 'reverted_at' | 'error'>>
  ): Promise<void> {
    updateById(this.sqlite, 'docx_apply', id, {
      status: values.status,
      updated_at: values.updated_at,
      reverted_at: values.reverted_at,
      last_error: values.error
    })
  }

  public async listRecords(
    filters?: ListDocxApplyRecordsRequest
  ): Promise<ListDocxApplyRecordsResponse> {
    const params = {
      partner_id: filters?.partnerId || null,
      status: filters?.status || null
    }
    const where = buildWhere([
      filters?.partnerId ? 'partner_id = @partner_id' : undefined,
      filters?.status ? 'status = @status' : undefined
    ])
    const rows = this.sqlite
      .prepare(`SELECT * FROM docx_apply WHERE ${where} ORDER BY updated_at DESC`)
      .all(params) as DocxApplyRow[]
    const items = rows.map(toDocxApplyRecord)
    return { items, total: items.length }
  }

  public async getRecord(applyId: string): Promise<DocxApplyRecord | null> {
    const row = this.sqlite
      .prepare('SELECT * FROM docx_apply WHERE id = ? LIMIT 1')
      .get(applyId) as DocxApplyRow | undefined
    return row ? toDocxApplyRecord(row) : null
  }
}
