import type {
  WorkspaceFileIndexRecord,
  WorkspaceFileIndexStatus,
  WorkspaceFileSummary,
  WorkspaceSource
} from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildInClause,
  insertOrReplace,
  toOptionalNumber,
  toOptionalString,
  toRequiredNumber,
  toRequiredString,
  updateById
} from '../sqlite/sqliteUtils'

type WorkspaceSourceRow = Record<string, unknown>
type WorkspaceFileIndexRow = Record<string, unknown>

const EMPTY_SUMMARY: WorkspaceFileSummary = {
  file_count: 0,
  indexed_file_count: 0,
  needs_index_count: 0,
  failed_file_count: 0
}

const normalizeIndexStatus = (value: unknown): WorkspaceFileIndexStatus => {
  const normalized = String(value ?? '').trim()
  if (normalized === 'indexing' || normalized === 'indexed' || normalized === 'failed') {
    return normalized
  }
  return 'needs_index'
}

const toWorkspaceSource = (row: WorkspaceSourceRow): WorkspaceSource => ({
  id: toRequiredString(row.id),
  root_path: toRequiredString(row.root_path),
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

const toWorkspaceFileIndexWriteRow = (record: WorkspaceFileIndexRecord) => ({
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
  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveWorkspace(workspace: WorkspaceSource): Promise<void> {
    insertOrReplace(this.sqlite, 'workspace_source', {
      id: workspace.id,
      root_path: workspace.root_path,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at
    })
  }

  public async listWorkspaces(): Promise<WorkspaceSource[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM workspace_source ORDER BY created_at ASC')
      .all() as WorkspaceSourceRow[]
    return rows.map(toWorkspaceSource)
  }

  public async getWorkspaceById(id: string): Promise<WorkspaceSource | null> {
    const row = this.sqlite.prepare('SELECT * FROM workspace_source WHERE id = ?').get(id) as
      | WorkspaceSourceRow
      | undefined
    return row ? toWorkspaceSource(row) : null
  }

  public async getWorkspaceByRootPath(rootPath: string): Promise<WorkspaceSource | null> {
    if (!String(rootPath || '').trim()) return null
    const row = this.sqlite
      .prepare('SELECT * FROM workspace_source WHERE root_path = ? LIMIT 1')
      .get(rootPath) as WorkspaceSourceRow | undefined
    return row ? toWorkspaceSource(row) : null
  }

  public async updateWorkspace(
    id: string,
    values: Partial<Pick<WorkspaceSource, 'root_path' | 'updated_at'>>
  ): Promise<void> {
    updateById(this.sqlite, 'workspace_source', id, values)
  }

  public async deleteWorkspace(id: string): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM workspace_source WHERE id = ?').run(id)
      this.sqlite.prepare('DELETE FROM workspace_file_index WHERE workspace_id = ?').run(id)
      this.sqlite.prepare('DELETE FROM document WHERE workspace_id = ?').run(id)
    })
  }

  public async replaceWorkspaceFileIndexRecords(
    workspaceId: string,
    records: WorkspaceFileIndexRecord[]
  ): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM workspace_file_index WHERE workspace_id = ?').run(workspaceId)
      const stmt = this.sqlite.prepare(
        `
        INSERT INTO workspace_file_index (
          id, workspace_id, relative_path, absolute_path, name, file_ext, size, mtime_ms,
          content_hash, index_status, document_id, indexed_at, last_checked_at, last_error,
          created_at, updated_at
        ) VALUES (
          @id, @workspace_id, @relative_path, @absolute_path, @name, @file_ext, @size, @mtime_ms,
          @content_hash, @index_status, @document_id, @indexed_at, @last_checked_at, @last_error,
          @created_at, @updated_at
        )
      `
      )
      for (const record of records) stmt.run(toWorkspaceFileIndexWriteRow(record))
    })
  }

  public async upsertWorkspaceFileIndexRecords(records: WorkspaceFileIndexRecord[]): Promise<void> {
    if (records.length === 0) return
    this.sqlite.transaction(() => {
      for (const record of records) {
        insertOrReplace(this.sqlite, 'workspace_file_index', toWorkspaceFileIndexWriteRow(record))
      }
    })
  }

  public async listWorkspaceFileIndexRecords(
    workspaceId: string
  ): Promise<WorkspaceFileIndexRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM workspace_file_index WHERE workspace_id = ? ORDER BY relative_path ASC')
      .all(workspaceId) as WorkspaceFileIndexRow[]
    return rows.map(toWorkspaceFileIndexRecord)
  }

  public async getWorkspaceFileIndexRecordByPath(
    workspaceId: string,
    relativePath: string
  ): Promise<WorkspaceFileIndexRecord | null> {
    const row = this.sqlite
      .prepare(
        'SELECT * FROM workspace_file_index WHERE workspace_id = ? AND relative_path = ? LIMIT 1'
      )
      .get(workspaceId, relativePath) as WorkspaceFileIndexRow | undefined
    return row ? toWorkspaceFileIndexRecord(row) : null
  }

  public async listWorkspaceFileIndexRecordsByPaths(
    workspaceId: string,
    relativePaths: string[]
  ): Promise<WorkspaceFileIndexRecord[]> {
    const paths = Array.from(new Set(relativePaths.map((value) => String(value).trim()).filter(Boolean)))
    if (paths.length === 0) return []
    const placeholders = paths.map(() => '?').join(', ')
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM workspace_file_index WHERE workspace_id = ? AND relative_path IN (${placeholders})`
      )
      .all(workspaceId, ...paths) as WorkspaceFileIndexRow[]
    return rows.map(toWorkspaceFileIndexRecord)
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
    updateById(this.sqlite, 'workspace_file_index', id, values)
  }

  public async deleteWorkspaceFileIndexRecords(workspaceId: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM workspace_file_index WHERE workspace_id = ?').run(workspaceId)
  }

  public async deleteWorkspaceFileIndexRecordsByIds(ids: string[]): Promise<void> {
    const params: Record<string, string | number | null> = {}
    const where = buildInClause('id', ids, params, 'id')
    if (!where) return
    this.sqlite.prepare(`DELETE FROM workspace_file_index WHERE ${where}`).run(params)
  }

  public async listWorkspaceDocumentIds(): Promise<string[]> {
    const rows = this.sqlite
      .prepare('SELECT DISTINCT document_id FROM workspace_file_index WHERE document_id IS NOT NULL')
      .all() as Array<{ document_id?: unknown }>
    return rows.map((row) => toOptionalString(row.document_id)).filter(Boolean) as string[]
  }

  public async getWorkspaceFileSummary(workspaceId: string): Promise<WorkspaceFileSummary> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT index_status, COUNT(*) AS count
        FROM workspace_file_index
        WHERE workspace_id = ?
        GROUP BY index_status
      `
      )
      .all(workspaceId) as Array<{ index_status?: unknown; count?: unknown }>
    const summary = { ...EMPTY_SUMMARY }
    for (const row of rows) {
      const count = toRequiredNumber(row.count)
      summary.file_count += count
      const status = normalizeIndexStatus(row.index_status)
      if (status === 'indexed') summary.indexed_file_count += count
      else if (status === 'failed') summary.failed_file_count += count
      else summary.needs_index_count += count
    }
    return summary
  }

  public async getAggregatedFileSummary(): Promise<WorkspaceFileSummary> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT index_status, COUNT(*) AS count
        FROM workspace_file_index
        GROUP BY index_status
      `
      )
      .all() as Array<{ index_status?: unknown; count?: unknown }>
    const summary = { ...EMPTY_SUMMARY }
    for (const row of rows) {
      const count = toRequiredNumber(row.count)
      summary.file_count += count
      const status = normalizeIndexStatus(row.index_status)
      if (status === 'indexed') summary.indexed_file_count += count
      else if (status === 'failed') summary.failed_file_count += count
      else summary.needs_index_count += count
    }
    return summary
  }

  public getEmptySummary(): WorkspaceFileSummary {
    return { ...EMPTY_SUMMARY }
  }

  public async failIndexingFileRecords(message: string, now = Date.now()): Promise<number> {
    const result = this.sqlite
      .prepare(
        `
        UPDATE workspace_file_index
        SET index_status = 'failed', last_error = @message, last_checked_at = @now, updated_at = @now
        WHERE index_status = 'indexing'
      `
      )
      .run({ message, now })
    return result.changes
  }
}
