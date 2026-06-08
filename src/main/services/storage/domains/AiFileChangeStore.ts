import type {
  AiFileChangeCapability,
  AiFileChangeOperation,
  AiFileChangeRecord,
  AiFileChangeStatus,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse
} from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined
type WriteRow = Record<string, PrimitiveRowValue>

type AiFileChangeRow = {
  id?: PrimitiveRowValue
  session_id?: PrimitiveRowValue
  run_id?: PrimitiveRowValue
  status?: PrimitiveRowValue
  capability?: PrimitiveRowValue
  path?: PrimitiveRowValue
  file_name?: PrimitiveRowValue
  operation?: PrimitiveRowValue
  change_count?: PrimitiveRowValue
  before_snapshot_path?: PrimitiveRowValue
  before_checksum?: PrimitiveRowValue
  after_checksum?: PrimitiveRowValue
  preview_path?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
  reverted_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
}

const toRequiredString = (value: PrimitiveRowValue): string => String(value ?? '')

const toOptionalString = (value: PrimitiveRowValue): string | undefined => {
  if (value == null) return undefined
  const next = String(value).trim()
  return next.length > 0 ? next : undefined
}

const toRequiredNumber = (value: PrimitiveRowValue, fallback = 0): number => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

const normalizeStatus = (value: PrimitiveRowValue): AiFileChangeStatus => {
  const normalized = String(value ?? '').trim()
  return normalized === 'reverted' || normalized === 'failed' ? normalized : 'applied'
}

const normalizeCapability = (value: PrimitiveRowValue): AiFileChangeCapability => {
  const normalized = String(value ?? '').trim()
  if (normalized === 'terminal_exec' || normalized === 'ppt') return normalized
  return 'docx'
}

const normalizeOperation = (value: PrimitiveRowValue): AiFileChangeOperation =>
  value === 'created' ? 'created' : 'updated'

const toRecord = (row: AiFileChangeRow): AiFileChangeRecord => ({
  id: toRequiredString(row.id),
  sessionId: toRequiredString(row.session_id),
  runId: toRequiredString(row.run_id),
  status: normalizeStatus(row.status),
  capability: normalizeCapability(row.capability),
  path: toRequiredString(row.path),
  fileName: toRequiredString(row.file_name),
  operation: normalizeOperation(row.operation),
  changeCount: toRequiredNumber(row.change_count),
  beforeSnapshotPath: toOptionalString(row.before_snapshot_path),
  beforeChecksum: toOptionalString(row.before_checksum),
  afterChecksum: toOptionalString(row.after_checksum),
  previewPath: toOptionalString(row.preview_path),
  createdAt: toRequiredNumber(row.created_at),
  updatedAt: toRequiredNumber(row.updated_at),
  revertedAt: toRequiredNumber(row.reverted_at) || undefined,
  error: toOptionalString(row.last_error)
})

const toWriteRow = (record: AiFileChangeRecord): WriteRow => ({
  id: record.id,
  session_id: record.sessionId,
  run_id: record.runId,
  status: record.status,
  capability: record.capability,
  path: record.path,
  file_name: record.fileName,
  operation: record.operation,
  change_count: record.changeCount,
  before_snapshot_path: record.beforeSnapshotPath,
  before_checksum: record.beforeChecksum,
  after_checksum: record.afterChecksum,
  preview_path: record.previewPath,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
  reverted_at: record.revertedAt,
  last_error: record.error
})

const omitUndefined = <T extends WriteRow>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) next[key] = value[key]
  }
  return next
}

export class AiFileChangeStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveRecord(record: AiFileChangeRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.AI_FILE_CHANGE)
    await table.delete(`id = '${this.core.escapeSqlString(record.id)}'`)
    await table.add([omitUndefined(toWriteRow(record))])
  }

  public async listRecords(
    filters?: ListAiFileChangeRecordsRequest
  ): Promise<ListAiFileChangeRecordsResponse> {
    const table = await this.core.openTable(LANCE_TABLES.AI_FILE_CHANGE)
    const where = this.core.combineWhere([
      filters?.sessionId ? `session_id = '${this.core.escapeSqlString(filters.sessionId)}'` : undefined,
      filters?.runId ? `run_id = '${this.core.escapeSqlString(filters.runId)}'` : undefined,
      filters?.status ? `status = '${this.core.escapeSqlString(filters.status)}'` : undefined
    ])
    const rows = (await (where ? table.query().where(where) : table.query()).toArray()) as AiFileChangeRow[]
    const items = rows.map(toRecord).sort((a, b) => b.updatedAt - a.updatedAt)
    return { items, total: items.length }
  }

  public async getRecord(
    request: GetAiFileChangeRecordRequest
  ): Promise<GetAiFileChangeRecordResponse> {
    const table = await this.core.openTable(LANCE_TABLES.AI_FILE_CHANGE)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(request.changeId)}'`)
      .limit(1)
      .toArray()) as AiFileChangeRow[]
    const record = rows[0] ? toRecord(rows[0]) : undefined
    return record ? { record } : { error: 'file change record not found' }
  }
}
