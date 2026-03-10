import type { DocumentImportStatus, WebSourceIdentityKind, WebSourceRecord } from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined

type WebSourceRow = {
  id?: PrimitiveRowValue
  identity_kind?: PrimitiveRowValue
  normalized_url?: PrimitiveRowValue
  url?: PrimitiveRowValue
  title?: PrimitiveRowValue
  document_id?: PrimitiveRowValue
  import_status?: PrimitiveRowValue
  include_selectors_json?: PrimitiveRowValue
  exclude_selectors_json?: PrimitiveRowValue
  fetched_at?: PrimitiveRowValue
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

const normalizeImportStatus = (value: PrimitiveRowValue): DocumentImportStatus => {
  const next = Number(value)
  if (next === 1) return 1
  if (next === 3) return 3
  return 2
}

const normalizeIdentityKind = (value: PrimitiveRowValue): WebSourceIdentityKind =>
  String(value ?? '').trim() === 'normalized_url' ? 'normalized_url' : 'normalized_url'

const toWebSourceRecord = (row: WebSourceRow): WebSourceRecord => ({
  id: toRequiredString(row.id),
  identity_kind: normalizeIdentityKind(row.identity_kind),
  normalized_url: toRequiredString(row.normalized_url),
  url: toRequiredString(row.url),
  title: toOptionalString(row.title),
  document_id: toOptionalString(row.document_id),
  import_status: normalizeImportStatus(row.import_status),
  include_selectors: parseStringArray(row.include_selectors_json),
  exclude_selectors: parseStringArray(row.exclude_selectors_json),
  fetched_at: toOptionalNumber(row.fetched_at),
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

  public async saveWebSource(source: WebSourceRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    await table.delete(`id = '${this.core.escapeSqlString(source.id)}'`)
    await table.add([
      {
        id: source.id,
        identity_kind: source.identity_kind,
        normalized_url: source.normalized_url,
        url: source.url,
        title: source.title,
        document_id: source.document_id,
        import_status: source.import_status,
        include_selectors_json: stringifyStringArray(source.include_selectors),
        exclude_selectors_json: stringifyStringArray(source.exclude_selectors),
        fetched_at: source.fetched_at,
        last_error: source.last_error,
        created_at: source.created_at,
        updated_at: source.updated_at
      }
    ])
  }

  public async listWebSources(): Promise<WebSourceRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const rows = (await table.query().toArray()) as WebSourceRow[]
    return rows.map(toWebSourceRecord).sort((a, b) => a.created_at - b.created_at)
  }

  public async getWebSourceById(id: string): Promise<WebSourceRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WebSourceRow[]
    const row = rows[0]
    return row ? toWebSourceRecord(row) : null
  }

  public async getWebSourceByNormalizedUrl(normalizedUrl: string): Promise<WebSourceRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    const rows = (await table
      .query()
      .where(`normalized_url = '${this.core.escapeSqlString(normalizedUrl)}'`)
      .limit(1)
      .toArray()) as WebSourceRow[]
    const row = rows[0]
    return row ? toWebSourceRecord(row) : null
  }

  public async listWebSourcesByDocumentIds(documentIds: string[]): Promise<WebSourceRecord[]> {
    if (documentIds.length === 0) return []
    const where = this.core.buildInClause('document_id', documentIds)
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
        | 'import_status'
        | 'include_selectors'
        | 'exclude_selectors'
        | 'fetched_at'
        | 'last_error'
        | 'updated_at'
      >
    >
  ): Promise<void> {
    const nextValues = omitUndefined({
      url: values.url,
      title: values.title,
      document_id: values.document_id,
      import_status: values.import_status,
      include_selectors_json: stringifyStringArray(values.include_selectors),
      exclude_selectors_json: stringifyStringArray(values.exclude_selectors),
      fetched_at: values.fetched_at,
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

  public async deleteWebSource(id: string): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WEB_SOURCE)
    await table.delete(`id = '${this.core.escapeSqlString(id)}'`)
  }
}
