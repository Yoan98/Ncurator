import type {
  DocxApplyRecord,
  DocxApplyStatus,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse
} from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined
type WriteRow = Record<string, PrimitiveRowValue>

type DocxApplyRow = {
  id?: PrimitiveRowValue
  session_id?: PrimitiveRowValue
  run_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  source_path?: PrimitiveRowValue
  source_name?: PrimitiveRowValue
  operation?: PrimitiveRowValue
  final_revision_ref?: PrimitiveRowValue
  change_count?: PrimitiveRowValue
  before_exists?: PrimitiveRowValue
  before_snapshot_path?: PrimitiveRowValue
  before_checksum?: PrimitiveRowValue
  before_byte_size?: PrimitiveRowValue
  before_modified_at?: PrimitiveRowValue
  preview_diff_artifact_path?: PrimitiveRowValue
  preview_diff_checksum?: PrimitiveRowValue
  preview_diff_byte_size?: PrimitiveRowValue
  after_checksum?: PrimitiveRowValue
  after_byte_size?: PrimitiveRowValue
  after_modified_at?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
  reverted_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
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

const toRequiredBoolean = (value: PrimitiveRowValue): boolean => value === true || value === 'true'

const normalizeStatus = (value: PrimitiveRowValue): DocxApplyStatus => {
  const normalized = String(value ?? '').trim()
  return normalized === 'reverted' || normalized === 'failed' ? normalized : 'applied'
}

const normalizeOperation = (value: PrimitiveRowValue): DocxApplyRecord['operation'] =>
  value === 'created' ? 'created' : 'updated'

const toDocxApplyRecord = (row: DocxApplyRow): DocxApplyRecord => ({
  id: toRequiredString(row.id),
  session_id: toRequiredString(row.session_id),
  run_id: toRequiredString(row.run_id),
  status: normalizeStatus(row.status),
  source_path: toRequiredString(row.source_path),
  source_name: toRequiredString(row.source_name),
  operation: normalizeOperation(row.operation),
  final_revision_ref: toRequiredString(row.final_revision_ref),
  change_count: toRequiredNumber(row.change_count),
  before_exists: toRequiredBoolean(row.before_exists),
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

const omitUndefined = <T extends WriteRow>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) next[key] = value[key]
  }
  return next
}

const toDocxApplyWriteRow = (record: DocxApplyRecord): WriteRow => ({
  id: record.id,
  session_id: record.session_id,
  run_id: record.run_id,
  status: record.status,
  source_path: record.source_path,
  source_name: record.source_name,
  operation: record.operation,
  final_revision_ref: record.final_revision_ref,
  change_count: record.change_count,
  before_exists: record.before_exists,
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
  public constructor(private readonly core: LanceDbCore) {}

  public async saveRecord(record: DocxApplyRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.DOCX_APPLY)
    await table.delete(`id = '${this.core.escapeSqlString(record.id)}'`)
    await table.add([omitUndefined(toDocxApplyWriteRow(record))])
  }

  public async listRecords(
    filters?: ListDocxApplyRecordsRequest
  ): Promise<ListDocxApplyRecordsResponse> {
    const table = await this.core.openTable(LANCE_TABLES.DOCX_APPLY)
    const where = this.core.combineWhere([
      filters?.sessionId ? `session_id = '${this.core.escapeSqlString(filters.sessionId)}'` : undefined,
      filters?.status ? `status = '${this.core.escapeSqlString(filters.status)}'` : undefined
    ])
    const rows = (await (where ? table.query().where(where) : table.query()).toArray()) as DocxApplyRow[]
    const items = rows.map(toDocxApplyRecord).sort((a, b) => b.updated_at - a.updated_at)
    return { items, total: items.length }
  }

  public async getRecord(applyId: string): Promise<DocxApplyRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.DOCX_APPLY)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(applyId)}'`)
      .limit(1)
      .toArray()) as DocxApplyRow[]
    return rows[0] ? toDocxApplyRecord(rows[0]) : null
  }
}
