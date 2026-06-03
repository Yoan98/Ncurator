import type {
  WebSourceIdentityKind,
  WebSourceIndexStatus,
  WebSourceRecord,
  WorkspaceWebSummary
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined

type WebSourceRow = {
  id?: PrimitiveRowValue
  workspace_id?: PrimitiveRowValue
  identity_kind?: PrimitiveRowValue
  normalized_url?: PrimitiveRowValue
  url?: PrimitiveRowValue
  title?: PrimitiveRowValue
  document_id?: PrimitiveRowValue
  index_status?: PrimitiveRowValue
  include_selectors_json?: PrimitiveRowValue
  exclude_selectors_json?: PrimitiveRowValue
  fetched_at?: PrimitiveRowValue
  last_checked_at?: PrimitiveRowValue
  last_crawled_at?: PrimitiveRowValue
  last_indexed_at?: PrimitiveRowValue
  etag?: PrimitiveRowValue
  last_modified?: PrimitiveRowValue
  content_length?: PrimitiveRowValue
  content_hash?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
  created_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
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

const parseStringArray = (value: PrimitiveRowValue): string[] | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined
    const next = parsed.map((item) => String(item || '').trim()).filter(Boolean)
    return next.length > 0 ? next : undefined
  } catch {
    return undefined
  }
}

const normalizeIdentityKind = (value: PrimitiveRowValue): WebSourceIdentityKind =>
  String(value ?? '').trim() === 'normalized_url' ? 'normalized_url' : 'normalized_url'

const normalizeIndexStatus = (value: PrimitiveRowValue): WebSourceIndexStatus => {
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

const stringifyStringArray = (value?: string[]): string | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return JSON.stringify(value.map((item) => String(item || '').trim()).filter(Boolean))
}

const omitUndefined = <T extends Record<string, string | number | undefined>>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      next[key] = value[key]
    }
  }
  return next
}

export class WebSourceStore {
  public constructor(private readonly core: LanceDbCore) {}

  private buildWorkspaceWhere(workspaceId?: string): string | undefined {
    const normalized = String(workspaceId || '').trim()
    if (!normalized) return undefined
    return `workspace_id = '${this.core.escapeSqlString(normalized)}'`
  }

  public async saveWebSource(source: WebSourceRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    await table.delete(`id = '${this.core.escapeSqlString(source.id)}'`)
    await table.add([
      {
        id: source.id,
        workspace_id: source.workspace_id,
        identity_kind: source.identity_kind,
        normalized_url: source.normalized_url,
        url: source.url,
        title: source.title,
        document_id: source.document_id,
        index_status: source.index_status,
        include_selectors_json: stringifyStringArray(source.include_selectors),
        exclude_selectors_json: stringifyStringArray(source.exclude_selectors),
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
      }
    ])
  }

  public async listWebSources(workspaceId?: string): Promise<WebSourceRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const query = table.query()
    const where = this.buildWorkspaceWhere(workspaceId)
    if (where) query.where(where)
    const rows = (await query.toArray()) as WebSourceRow[]
    return rows.map(toWebSourceRecord).sort((a, b) => a.created_at - b.created_at)
  }

  public async getWebSourceById(id: string, workspaceId?: string): Promise<WebSourceRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const where = this.core.combineWhere([
      `id = '${this.core.escapeSqlString(id)}'`,
      this.buildWorkspaceWhere(workspaceId)
    ])
    const rows = (await table
      .query()
      .where(where || `id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WebSourceRow[]
    const row = rows[0]
    return row ? toWebSourceRecord(row) : null
  }

  public async getWebSourceByNormalizedUrl(
    normalizedUrl: string,
    workspaceId?: string
  ): Promise<WebSourceRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const where = this.core.combineWhere([
      `normalized_url = '${this.core.escapeSqlString(normalizedUrl)}'`,
      this.buildWorkspaceWhere(workspaceId)
    ])
    const rows = (await table
      .query()
      .where(where || `normalized_url = '${this.core.escapeSqlString(normalizedUrl)}'`)
      .limit(1)
      .toArray()) as WebSourceRow[]
    const row = rows[0]
    return row ? toWebSourceRecord(row) : null
  }

  public async listWebSourcesByDocumentIds(
    documentIds: string[],
    workspaceId?: string
  ): Promise<WebSourceRecord[]> {
    if (documentIds.length === 0) return []
    const where = this.core.combineWhere([
      this.core.buildInClause('document_id', documentIds),
      this.buildWorkspaceWhere(workspaceId)
    ])
    if (!where) return []
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const rows = (await table.query().where(where).toArray()) as WebSourceRow[]
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
    const nextValues = omitUndefined({
      url: values.url,
      title: values.title,
      document_id: values.document_id,
      workspace_id: values.workspace_id,
      index_status: values.index_status,
      include_selectors_json: stringifyStringArray(values.include_selectors),
      exclude_selectors_json: stringifyStringArray(values.exclude_selectors),
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
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async deleteWebSource(id: string, workspaceId?: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const where = this.core.combineWhere([
      `id = '${this.core.escapeSqlString(id)}'`,
      this.buildWorkspaceWhere(workspaceId)
    ])
    if (!where) return
    await table.delete(where)
  }

  public async getWorkspaceWebSummary(workspaceId: string): Promise<WorkspaceWebSummary> {
    const sources = await this.listWebSources(workspaceId)
    return {
      web_count: sources.length,
      needs_index_count: sources.filter((source) => source.index_status === 'needs_index').length,
      failed_count: sources.filter(
        (source) =>
          source.index_status === 'crawl_failed' || source.index_status === 'index_failed'
      ).length
    }
  }
}
