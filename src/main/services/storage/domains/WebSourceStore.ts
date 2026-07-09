import type {
  WebSourceIdentityKind,
  WebSourceIndexStatus,
  WebSourceRecord,
  WorkspaceWebSummary
} from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildInClause,
  buildWhere,
  insertOrReplace,
  jsonStringify,
  parseStringArray,
  toOptionalNumber,
  toOptionalString,
  toRequiredNumber,
  toRequiredString,
  updateById
} from '../sqlite/sqliteUtils'

type WebSourceRow = Record<string, unknown>

const normalizeIdentityKind = (value: unknown): WebSourceIdentityKind =>
  String(value ?? '').trim() === 'normalized_url' ? 'normalized_url' : 'normalized_url'

const normalizeIndexStatus = (value: unknown): WebSourceIndexStatus => {
  const next = String(value ?? '').trim()
  switch (next) {
    case 'crawling':
    case 'crawl_failed':
    case 'indexing':
    case 'indexed':
    case 'index_failed':
      return next
    default:
      return 'needs_index'
  }
}

const toWebSourceRecord = (row: WebSourceRow): WebSourceRecord => ({
  id: toRequiredString(row.id),
  workspace_id: toRequiredString(row.workspace_id),
  identity_kind: normalizeIdentityKind(row.identity_kind),
  normalized_url: toRequiredString(row.normalized_url),
  url: toRequiredString(row.url),
  title: toOptionalString(row.title),
  document_id: toOptionalString(row.document_id),
  index_status: normalizeIndexStatus(row.index_status),
  include_selectors: parseStringArray(row.include_selectors_json),
  exclude_selectors: parseStringArray(row.exclude_selectors_json),
  fetched_at: toOptionalNumber(row.fetched_at),
  last_checked_at: toOptionalNumber(row.last_checked_at),
  last_crawled_at: toOptionalNumber(row.last_crawled_at),
  last_indexed_at: toOptionalNumber(row.last_indexed_at),
  etag: toOptionalString(row.etag),
  last_modified: toOptionalString(row.last_modified),
  content_length: toOptionalNumber(row.content_length),
  content_hash: toOptionalString(row.content_hash),
  last_error: toOptionalString(row.last_error),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at)
})

export class WebSourceStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  private buildWorkspaceWhere(workspaceId?: string): string | undefined {
    return String(workspaceId || '').trim() ? 'workspace_id = @workspace_id' : undefined
  }

  public async saveWebSource(source: WebSourceRecord): Promise<void> {
    insertOrReplace(this.sqlite, 'web_source', {
      id: source.id,
      workspace_id: source.workspace_id,
      identity_kind: source.identity_kind,
      normalized_url: source.normalized_url,
      url: source.url,
      title: source.title,
      document_id: source.document_id,
      index_status: source.index_status,
      include_selectors_json: jsonStringify(source.include_selectors),
      exclude_selectors_json: jsonStringify(source.exclude_selectors),
      fetched_at: source.fetched_at,
      last_checked_at: source.last_checked_at,
      last_crawled_at: source.last_crawled_at,
      last_indexed_at: source.last_indexed_at,
      etag: source.etag,
      last_modified: source.last_modified,
      content_length: source.content_length,
      content_hash: source.content_hash,
      last_error: source.last_error,
      created_at: source.created_at,
      updated_at: source.updated_at
    })
  }

  public async listWebSources(workspaceId?: string): Promise<WebSourceRecord[]> {
    const params = { workspace_id: workspaceId || null }
    const where = this.buildWorkspaceWhere(workspaceId)
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM web_source ${where ? `WHERE ${where}` : ''} ORDER BY created_at ASC`
      )
      .all(params) as WebSourceRow[]
    return rows.map(toWebSourceRecord)
  }

  public async getWebSourceById(id: string, workspaceId?: string): Promise<WebSourceRecord | null> {
    const params = { id, workspace_id: workspaceId || null }
    const where = buildWhere(['id = @id', this.buildWorkspaceWhere(workspaceId)])
    const row = this.sqlite.prepare(`SELECT * FROM web_source WHERE ${where} LIMIT 1`).get(params) as
      | WebSourceRow
      | undefined
    return row ? toWebSourceRecord(row) : null
  }

  public async getWebSourceByNormalizedUrl(
    normalizedUrl: string,
    workspaceId?: string
  ): Promise<WebSourceRecord | null> {
    const params = { normalized_url: normalizedUrl, workspace_id: workspaceId || null }
    const where = buildWhere(['normalized_url = @normalized_url', this.buildWorkspaceWhere(workspaceId)])
    const row = this.sqlite.prepare(`SELECT * FROM web_source WHERE ${where} LIMIT 1`).get(params) as
      | WebSourceRow
      | undefined
    return row ? toWebSourceRecord(row) : null
  }

  public async listWebSourcesByDocumentIds(
    documentIds: string[],
    workspaceId?: string
  ): Promise<WebSourceRecord[]> {
    const params: Record<string, string | number | null> = { workspace_id: workspaceId || null }
    const where = buildWhere([
      buildInClause('document_id', documentIds, params, 'document_id'),
      this.buildWorkspaceWhere(workspaceId)
    ])
    const rows = this.sqlite
      .prepare(`SELECT * FROM web_source WHERE ${where}`)
      .all(params) as WebSourceRow[]
    return rows.map(toWebSourceRecord)
  }

  public async updateWebSource(
    id: string,
    values: Partial<
      Pick<
        WebSourceRecord,
        | 'url'
        | 'title'
        | 'document_id'
        | 'workspace_id'
        | 'index_status'
        | 'include_selectors'
        | 'exclude_selectors'
        | 'fetched_at'
        | 'last_checked_at'
        | 'last_crawled_at'
        | 'last_indexed_at'
        | 'etag'
        | 'last_modified'
        | 'content_length'
        | 'content_hash'
        | 'last_error'
        | 'updated_at'
      >
    >
  ): Promise<void> {
    updateById(this.sqlite, 'web_source', id, {
      url: values.url,
      title: values.title,
      document_id: values.document_id,
      workspace_id: values.workspace_id,
      index_status: values.index_status,
      include_selectors_json: values.include_selectors
        ? JSON.stringify(values.include_selectors)
        : undefined,
      exclude_selectors_json: values.exclude_selectors
        ? JSON.stringify(values.exclude_selectors)
        : undefined,
      fetched_at: values.fetched_at,
      last_checked_at: values.last_checked_at,
      last_crawled_at: values.last_crawled_at,
      last_indexed_at: values.last_indexed_at,
      etag: values.etag,
      last_modified: values.last_modified,
      content_length: values.content_length,
      content_hash: values.content_hash,
      last_error: values.last_error,
      updated_at: values.updated_at
    })
  }

  public async deleteWebSource(id: string, workspaceId?: string): Promise<void> {
    const params = { id, workspace_id: workspaceId || null }
    const where = buildWhere(['id = @id', this.buildWorkspaceWhere(workspaceId)])
    this.sqlite.prepare(`DELETE FROM web_source WHERE ${where}`).run(params)
  }

  public async getWorkspaceWebSummary(workspaceId: string): Promise<WorkspaceWebSummary> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT index_status, COUNT(*) AS count
        FROM web_source
        WHERE workspace_id = ?
        GROUP BY index_status
      `
      )
      .all(workspaceId) as Array<{ index_status?: unknown; count?: unknown }>
    const summary: WorkspaceWebSummary = { web_count: 0, needs_index_count: 0, failed_count: 0 }
    for (const row of rows) {
      const count = toRequiredNumber(row.count)
      summary.web_count += count
      const status = normalizeIndexStatus(row.index_status)
      if (status === 'needs_index') summary.needs_index_count += count
      if (status === 'crawl_failed' || status === 'index_failed') summary.failed_count += count
    }
    return summary
  }

  public async failRunningSources(message: string, now = Date.now()): Promise<number> {
    const result = this.sqlite
      .prepare(
        `
        UPDATE web_source
        SET index_status = CASE
            WHEN index_status = 'crawling' THEN 'crawl_failed'
            ELSE 'index_failed'
          END,
          last_error = @message,
          updated_at = @now
        WHERE index_status IN ('crawling','indexing')
      `
      )
      .run({ message, now })
    return result.changes
  }
}
