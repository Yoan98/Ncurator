import type {
  WorkspaceFileIndexRecord,
  WorkspaceFileIndexStatus,
  WorkspaceFileSummary,
  WorkspaceSource
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined
type WorkspaceWriteRow = Record<string, PrimitiveRowValue>

type WorkspaceSourceRow = {
  id?: PrimitiveRowValue
  name?: PrimitiveRowValue
  root_path?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

type WorkspaceFileIndexRow = {
  id?: PrimitiveRowValue
  workspace_id?: PrimitiveRowValue
  relative_path?: PrimitiveRowValue
  absolute_path?: PrimitiveRowValue
  name?: PrimitiveRowValue
  file_ext?: PrimitiveRowValue
  size?: PrimitiveRowValue
  mtime_ms?: PrimitiveRowValue
  content_hash?: PrimitiveRowValue
  index_status?: PrimitiveRowValue
  document_id?: PrimitiveRowValue
  indexed_at?: PrimitiveRowValue
  last_checked_at?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
}

const EMPTY_SUMMARY: WorkspaceFileSummary = {
  file_count: 0,
  indexed_file_count: 0,
  needs_index_count: 0,
  failed_file_count: 0
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

const normalizeIndexStatus = (value: PrimitiveRowValue): WorkspaceFileIndexStatus => {
  const normalized = String(value ?? '').trim()
  switch (normalized) {
    case 'indexing':
    case 'indexed':
    case 'failed':
      return normalized
    default:
      return 'needs_index'
  }
}

const toWorkspaceSource = (row: WorkspaceSourceRow): WorkspaceSource => ({
  id: toRequiredString(row.id),
  name: toRequiredString(row.name),
  root_path: toOptionalString(row.root_path),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const toWorkspaceFileIndexRecord = (row: WorkspaceFileIndexRow): WorkspaceFileIndexRecord => ({
  id: toRequiredString(row.id),
  workspace_id: toRequiredString(row.workspace_id),
  relative_path: toRequiredString(row.relative_path),
  absolute_path: toRequiredString(row.absolute_path),
  name: toRequiredString(row.name),
  file_ext: toRequiredString(row.file_ext),
  size: toOptionalNumber(row.size),
  mtime_ms: toOptionalNumber(row.mtime_ms),
  content_hash: toOptionalString(row.content_hash),
  index_status: normalizeIndexStatus(row.index_status),
  document_id: toOptionalString(row.document_id),
  indexed_at: toOptionalNumber(row.indexed_at),
  last_checked_at: toOptionalNumber(row.last_checked_at),
  last_error: toOptionalString(row.last_error),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

const omitUndefined = <T extends Record<string, string | number | boolean | null | undefined>>(
  value: T
): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      next[key] = value[key]
    }
  }
  return next
}

const toWorkspaceSourceWriteRow = (workspace: WorkspaceSource): WorkspaceWriteRow => ({
  id: workspace.id,
  name: workspace.name,
  root_path: workspace.root_path,
  created_at: workspace.created_at,
  updated_at: workspace.updated_at
})

const toWorkspaceFileIndexWriteRow = (record: WorkspaceFileIndexRecord): WorkspaceWriteRow => ({
  id: record.id,
  workspace_id: record.workspace_id,
  relative_path: record.relative_path,
  absolute_path: record.absolute_path,
  name: record.name,
  file_ext: record.file_ext,
  size: record.size,
  mtime_ms: record.mtime_ms,
  content_hash: record.content_hash,
  index_status: record.index_status,
  document_id: record.document_id,
  indexed_at: record.indexed_at,
  last_checked_at: record.last_checked_at,
  last_error: record.last_error,
  created_at: record.created_at,
  updated_at: record.updated_at
})

export class WorkspaceStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveWorkspace(workspace: WorkspaceSource): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    await table.delete(`id = '${this.core.escapeSqlString(workspace.id)}'`)
    await table.add([toWorkspaceSourceWriteRow(workspace)])
  }

  public async listWorkspaces(): Promise<WorkspaceSource[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table.query().toArray()) as WorkspaceSourceRow[]
    return rows.map(toWorkspaceSource).sort((a, b) => a.created_at - b.created_at)
  }

  public async getWorkspaceById(id: string): Promise<WorkspaceSource | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WorkspaceSourceRow[]
    const row = rows[0]
    return row ? toWorkspaceSource(row) : null
  }

  public async getWorkspaceByRootPath(rootPath: string): Promise<WorkspaceSource | null> {
    if (!String(rootPath || '').trim()) return null
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const rows = (await table
      .query()
      .where(`root_path = '${this.core.escapeSqlString(rootPath)}'`)
      .limit(1)
      .toArray()) as WorkspaceSourceRow[]
    const row = rows[0]
    return row ? toWorkspaceSource(row) : null
  }

  public async updateWorkspace(
    id: string,
    values: Partial<Pick<WorkspaceSource, 'name' | 'root_path' | 'updated_at'>>
  ): Promise<void> {
    const nextValues = omitUndefined(values)
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async deleteWorkspace(id: string): Promise<void> {
    const safeId = this.core.escapeSqlString(id)
    const workspaceTable = await this.core.openTable(LANCE_TABLES.WORKSPACE_SOURCE)
    const fileIndexTable = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    const webSourceTable = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const chunkTable = await this.core.openTable(LANCE_TABLES.CHUNK)
    const documentTable = await this.core.openTable(LANCE_TABLES.DOCUMENT)
    await workspaceTable.delete(`id = '${safeId}'`)
    await fileIndexTable.delete(`workspace_id = '${safeId}'`)
    await webSourceTable.delete(`workspace_id = '${safeId}'`)
    await chunkTable.delete(`workspace_id = '${safeId}'`)
    await documentTable.delete(`workspace_id = '${safeId}'`)
  }

  public async replaceWorkspaceFileIndexRecords(
    workspaceId: string,
    records: WorkspaceFileIndexRecord[]
  ): Promise<void> {
    await this.deleteWorkspaceFileIndexRecords(workspaceId)
    if (records.length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    await table.add(records.map(toWorkspaceFileIndexWriteRow))
  }

  public async upsertWorkspaceFileIndexRecords(records: WorkspaceFileIndexRecord[]): Promise<void> {
    if (records.length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    for (const record of records) {
      await table.delete(`id = '${this.core.escapeSqlString(record.id)}'`)
    }
    await table.add(records.map(toWorkspaceFileIndexWriteRow))
  }

  public async listWorkspaceFileIndexRecords(workspaceId: string): Promise<WorkspaceFileIndexRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    const rows = (await table
      .query()
      .where(`workspace_id = '${this.core.escapeSqlString(workspaceId)}'`)
      .toArray()) as WorkspaceFileIndexRow[]
    return rows
      .map(toWorkspaceFileIndexRecord)
      .sort((a, b) => a.relative_path.localeCompare(b.relative_path))
  }

  public async getWorkspaceFileIndexRecordByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<WorkspaceFileIndexRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    const where = this.core.combineWhere([
      `workspace_id = '${this.core.escapeSqlString(workspaceId)}'`,
      `relative_path = '${this.core.escapeSqlString(relativePath)}'`
    ])
    const rows = (await table
      .query()
      .where(where || '')
      .limit(1)
      .toArray()) as WorkspaceFileIndexRow[]
    const row = rows[0]
    return row ? toWorkspaceFileIndexRecord(row) : null
  }

  public async updateWorkspaceFileIndexRecord(
    id: string,
    values: Partial<
      Pick<
        WorkspaceFileIndexRecord,
        | 'absolute_path'
        | 'size'
        | 'mtime_ms'
        | 'content_hash'
        | 'index_status'
        | 'document_id'
        | 'indexed_at'
        | 'last_checked_at'
        | 'last_error'
        | 'updated_at'
      >
    >
  ): Promise<void> {
    const nextValues = omitUndefined(values)
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async deleteWorkspaceFileIndexRecords(workspaceId: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    await table.delete(`workspace_id = '${this.core.escapeSqlString(workspaceId)}'`)
  }

  public async deleteWorkspaceFileIndexRecordsByIds(ids: string[]): Promise<void> {
    const where = this.core.buildInClause('id', ids)
    if (!where) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    await table.delete(where)
  }

  public async listWorkspaceDocumentIds(): Promise<string[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    const rows = (await table.query().toArray()) as WorkspaceFileIndexRow[]
    return Array.from(
      new Set(
        rows
          .map((row) => toOptionalString(row.document_id))
          .filter((documentId): documentId is string => Boolean(documentId))
      )
    )
  }

  public async getWorkspaceFileSummary(workspaceId: string): Promise<WorkspaceFileSummary> {
    const records = await this.listWorkspaceFileIndexRecords(workspaceId)
    return {
      file_count: records.length,
      indexed_file_count: records.filter((item) => item.index_status === 'indexed').length,
      needs_index_count: records.filter((item) => item.index_status === 'needs_index').length,
      failed_file_count: records.filter((item) => item.index_status === 'failed').length
    }
  }

  public getEmptySummary(): WorkspaceFileSummary {
    return { ...EMPTY_SUMMARY }
  }

  public async failIndexingFileRecords(message: string, now = Date.now()): Promise<number> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_FILE_INDEX)
    const rows = (await table.query().where("index_status = 'indexing'").toArray()) as WorkspaceFileIndexRow[]
    const records = rows.map(toWorkspaceFileIndexRecord)
    for (const record of records) {
      await this.updateWorkspaceFileIndexRecord(record.id, {
        index_status: 'failed',
        last_error: message,
        last_checked_at: now,
        updated_at: now
      })
    }
    return records.length
  }
}
