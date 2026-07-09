import type { SqliteCore } from './SqliteCore'

export type SqlitePrimitive = string | number | boolean | null | undefined
export type SqliteWriteRow = Record<string, SqlitePrimitive>

export const omitUndefined = <T extends SqliteWriteRow>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) next[key] = value[key]
  }
  return next
}

export const jsonStringify = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

export const parseJsonArray = <T>(value: unknown): T[] | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? (parsed as T[]) : undefined
  } catch {
    return undefined
  }
}

export const parseJsonObject = <T>(value: unknown): T | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

export const parseStringArray = (value: unknown): string[] | undefined => {
  const parsed = parseJsonArray<unknown>(value)
  if (!parsed) return undefined
  const next = parsed.map((item) => String(item || '').trim()).filter(Boolean)
  return next.length > 0 ? next : undefined
}

export const toOptionalString = (value: unknown): string | undefined => {
  if (value == null) return undefined
  const next = String(value).trim()
  return next.length > 0 ? next : undefined
}

export const toRequiredString = (value: unknown): string => String(value ?? '')

export const toOptionalNumber = (value: unknown): number | undefined => {
  if (value == null) return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

export const toRequiredNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export const toSqliteBoolean = (value: unknown): number => (value ? 1 : 0)

export const fromSqliteBoolean = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true'

export const buildWhere = (parts: Array<string | undefined>): string => {
  const clauses = parts.map((part) => String(part || '').trim()).filter(Boolean)
  return clauses.length > 0 ? clauses.map((part) => `(${part})`).join(' AND ') : '1 = 1'
}

export const buildInClause = (
  column: string,
  values?: string[],
  params?: Record<string, SqlitePrimitive>,
  prefix = column.replace(/[^a-zA-Z0-9_]/g, '_')
): string | undefined => {
  const list = (values || []).map((value) => String(value || '').trim()).filter(Boolean)
  if (list.length === 0) return undefined
  if (!params) {
    return `${column} IN (${list.map((value) => `'${value.replace(/'/g, "''")}'`).join(',')})`
  }
  const placeholders = list.map((value, index) => {
    const key = `${prefix}_${index}`
    params[key] = value
    return `@${key}`
  })
  return `${column} IN (${placeholders.join(',')})`
}

export const insertOrReplace = (
  sqlite: SqliteCore,
  table: string,
  row: SqliteWriteRow,
  mode: 'INSERT OR REPLACE' | 'INSERT OR IGNORE' = 'INSERT OR REPLACE'
): void => {
  const next = omitUndefined(row)
  const columns = Object.keys(next)
  if (columns.length === 0) return
  const placeholders = columns.map((column) => `@${column}`)
  sqlite
    .prepare(
      `${mode} INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
    )
    .run(next)
}

export const updateById = (
  sqlite: SqliteCore,
  table: string,
  id: string,
  values: SqliteWriteRow
): void => {
  const next = omitUndefined(values)
  const columns = Object.keys(next)
  if (columns.length === 0) return
  const sets = columns.map((column) => `${column} = @${column}`)
  sqlite.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`).run({
    ...next,
    id
  })
}
