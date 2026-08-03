import * as lancedb from '@lancedb/lancedb'
import fs from 'fs'
import * as arrow from 'apache-arrow'
import { getLanceDbPath } from '../../../utils/paths'
import type { TableConfig } from '../../../types/store'

export enum LanceDbCoreStatus {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error'
}

export const LANCE_TABLES = {
  CHUNK: 'vector_chunk'
} as const

export type LanceTableName = (typeof LANCE_TABLES)[keyof typeof LANCE_TABLES]

export class LanceDbCore {
  private db: lancedb.Connection | null = null
  private readonly dbPath: string
  private status: LanceDbCoreStatus = LanceDbCoreStatus.UNINITIALIZED
  private tableNamesCache: Set<string> | null = null
  private tableCache = new Map<string, object>()
  private tableWriteQueues = new Map<string, Promise<unknown>>()

  public constructor(dbPath?: string) {
    this.dbPath = dbPath || getLanceDbPath()
  }

  public getStatus(): LanceDbCoreStatus {
    return this.status
  }

  public isReady(): boolean {
    return this.status === LanceDbCoreStatus.READY
  }

  public async initialize(): Promise<void> {
    if (this.status === LanceDbCoreStatus.READY) return
    if (this.status === LanceDbCoreStatus.INITIALIZING) return

    this.status = LanceDbCoreStatus.INITIALIZING
    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true })
      }

      this.db = await lancedb.connect(this.dbPath)
      await this.ensureTables()
      this.status = LanceDbCoreStatus.READY
    } catch (error) {
      this.status = LanceDbCoreStatus.ERROR
      throw error
    }
  }

  public async close(): Promise<void> {
    for (const table of this.tableCache.values()) {
      const maybeTable = table as { close?: () => void }
      if (typeof maybeTable.close === 'function') maybeTable.close()
    }
    this.tableNamesCache = null
    this.tableCache.clear()
    this.tableWriteQueues.clear()
    this.db = null
    this.status = LanceDbCoreStatus.UNINITIALIZED
  }

  public getConnection(): lancedb.Connection {
    this.assertReady()
    return this.db!
  }

  public async tableExists(name: string): Promise<boolean> {
    this.assertReady()
    const names = await this.getTableNames()
    return names.has(name)
  }

  public async openTable(name: LanceTableName | string): Promise<any> {
    this.assertReady()
    const tableName = String(name)
    const cached = this.tableCache.get(tableName)
    if (cached) return cached

    const names = await this.getTableNames()
    if (!names.has(tableName)) {
      throw new Error(`Table not found: ${tableName}`)
    }
    const table = await this.db!.openTable(tableName)
    const wrapped = this.createSerializedTable(tableName, table)
    this.tableCache.set(tableName, wrapped)
    return wrapped
  }

  public async ensureLanceScalarIndexes(
    name: LanceTableName | string,
    columns: string[]
  ): Promise<void> {
    const normalizedColumns = columns.map((column) => String(column || '').trim()).filter(Boolean)
    if (normalizedColumns.length === 0) return

    const table = await this.openTable(name)
    const existing = await table.listIndices()
    const existingNames = new Set(
      existing.flatMap((index) => {
        const value = index as { name?: unknown; columns?: unknown }
        const names = [String(value.name || '')]
        if (Array.isArray(value.columns)) {
          names.push(...value.columns.map((column) => `${String(column)}_idx`))
        }
        return names.filter(Boolean)
      })
    )

    for (const column of normalizedColumns) {
      const indexName = `${column}_idx`
      if (existingNames.has(indexName)) continue
      await table.createIndex(column)
      existingNames.add(indexName)
    }
  }

  public async optimizeTables(names: Array<LanceTableName | string>): Promise<void> {
    for (const name of names) {
      const table = await this.openTable(name)
      await table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true })
    }
  }

  public escapeSqlString(value: string): string {
    return String(value || '').replace(/'/g, "''")
  }

  public buildInClause(column: string, values?: string[]): string | undefined {
    const list = (values || []).map((v) => String(v || '').trim()).filter(Boolean)
    if (list.length === 0) return undefined
    return `${column} IN (${list.map((v) => `'${this.escapeSqlString(v)}'`).join(',')})`
  }

  public combineWhere(parts: Array<string | undefined>): string | undefined {
    const clauses = parts.map((p) => (p || '').trim()).filter(Boolean)
    if (clauses.length === 0) return undefined
    if (clauses.length === 1) return clauses[0]
    return clauses.map((c) => `(${c})`).join(' AND ')
  }

  public buildWhereFromQuery(query?: string, fields?: string[]): string | undefined {
    const trimmed = String(query || '').trim()
    if (!trimmed) return undefined
    const isSql =
      /(\bAND\b|\bOR\b|\bNOT\b|=|>=|<=|>|<|\bLIKE\b|\bNOT LIKE\b|\bIN\b|\bIS NULL\b|\bIS NOT NULL\b|regexp_match\s*\()/i.test(
        trimmed
      )
    if (isSql) return trimmed

    const kw = this.escapeSqlString(trimmed)
    const targets = (fields || []).filter(Boolean)
    if (targets.length === 0) return undefined
    return targets.map((f) => `${f} LIKE '%${kw}%'`).join(' OR ')
  }

  private assertReady(): void {
    if (this.status !== LanceDbCoreStatus.READY || !this.db) {
      throw new Error(`LanceDbCore not ready: ${this.status}`)
    }
  }

  private async getTableNames(): Promise<Set<string>> {
    if (this.tableNamesCache) return this.tableNamesCache
    const names = new Set(await this.db!.tableNames())
    this.tableNamesCache = names
    return names
  }

  private async runTableWrite<T>(tableName: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tableWriteQueues.get(tableName) || Promise.resolve()
    const queued = previous.catch(() => undefined).then(operation)
    const tail = queued.catch(() => undefined)
    this.tableWriteQueues.set(tableName, tail)
    void tail.finally(() => {
      if (this.tableWriteQueues.get(tableName) === tail) {
        this.tableWriteQueues.delete(tableName)
      }
    })
    return await queued
  }

  private createSerializedTable<TTable extends object>(tableName: string, table: TTable): TTable {
    const writeMethods = new Set([
      'add',
      'update',
      'delete',
      'createIndex',
      'dropIndex',
      'optimize',
      'addColumns',
      'alterColumns',
      'dropColumns',
      'restore'
    ])
    const queryBuilderMethods = new Set(['search', 'vectorSearch', 'takeOffsets', 'takeRowIds'])
    return new Proxy(table, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (property === 'query' && typeof value === 'function') {
          return (...args: unknown[]) => value.apply(target, args)
        }
        if (queryBuilderMethods.has(String(property)) && typeof value === 'function') {
          return (...args: unknown[]) => value.apply(target, args)
        }
        if (property === 'mergeInsert' && typeof value === 'function') {
          return (...args: unknown[]) => {
            const builder = value.apply(target, args)
            return this.createSerializedMergeBuilder(tableName, builder)
          }
        }
        if (typeof value !== 'function') return value
        if (!writeMethods.has(String(property))) {
          return (...args: unknown[]) => Promise.resolve(value.apply(target, args))
        }
        return (...args: unknown[]) =>
          this.runTableWrite(tableName, async () => await value.apply(target, args))
      }
    })
  }

  private createSerializedMergeBuilder<TBuilder extends object>(
    tableName: string,
    builder: TBuilder
  ): TBuilder {
    return new Proxy(builder, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        if (property === 'toArray') {
          return (...args: unknown[]) => Promise.resolve(value.apply(target, args))
        }
        if (property === 'execute') {
          return (...args: unknown[]) =>
            this.runTableWrite(tableName, async () => await value.apply(target, args))
        }
        return (...args: unknown[]) => {
          const result = value.apply(target, args)
          if (result && typeof result === 'object' && typeof result.execute === 'function') {
            return this.createSerializedMergeBuilder(tableName, result)
          }
          return result
        }
      }
    })
  }

  private async ensureTables(): Promise<void> {
    if (!this.db) throw new Error('Database connection not established')
    const tableConfigs = this.getTableConfigs()
    for (const config of tableConfigs) {
      await this.ensureTable(config)
    }
  }

  private async ensureTable(config: TableConfig): Promise<void> {
    if (!this.db) throw new Error('Database connection not established')

    const tableNames = await this.getTableNames()
    if (!tableNames.has(config.name)) {
      await this.createTable(config)
      return
    }

    const table = await this.db.openTable(config.name)
    await this.assertTableSchemaMatches(config, table)

    if (config.scalarIndexColumns && config.scalarIndexColumns.length > 0) {
      await this.createMissingLanceScalarIndexes(table, config.scalarIndexColumns)
    }
  }

  private async createTable(config: TableConfig): Promise<void> {
    if (!this.db) throw new Error('Database connection not established')

    const table = await this.db.createEmptyTable(config.name, config.schema)
    this.tableNamesCache = null
    this.tableCache.delete(config.name)

    if (config.vectorIndexConfig) {
      await table.createIndex(config.vectorIndexConfig.column, config.vectorIndexConfig.options)
    }

    if (config.ftsIndexConfig) {
      await table.createIndex(config.ftsIndexConfig.column, config.ftsIndexConfig.options)
    }

    if (config.scalarIndexColumns) {
      await this.createMissingLanceScalarIndexes(table, config.scalarIndexColumns)
    }
  }

  private async assertTableSchemaMatches(
    config: TableConfig,
    table: { schema: () => Promise<arrow.Schema> }
  ): Promise<void> {
    const currentSchema = await table.schema()
    const describeField = (field: arrow.Field) =>
      `${field.name}:${String(field.type)}:${field.nullable ? 'nullable' : 'required'}`
    const currentFields = currentSchema.fields.map(describeField)
    const nextFields = config.schema.fields.map(describeField)
    const schemaChanged =
      currentFields.length !== nextFields.length ||
      currentFields.some((field, index) => field !== nextFields[index])
    if (!schemaChanged) return

    throw new Error(
      [
        `LanceDB table schema mismatch: ${config.name}`,
        `current=[${currentFields.join(', ')}]`,
        `expected=[${nextFields.join(', ')}]`,
        '当前试验阶段不做自动迁移，也不会自动删表。请手动删除本地 LanceDB 数据库后重建。'
      ].join(' ')
    )
  }

  private async createMissingLanceScalarIndexes(
    table: {
      listIndices: () => Promise<unknown[]>
      createIndex: (column: string) => Promise<void>
    },
    columns: string[]
  ): Promise<void> {
    const indices = await table.listIndices()
    const existingNames = new Set(
      indices.map((index) => String((index as { name?: unknown }).name || '')).filter(Boolean)
    )
    for (const column of columns) {
      if (existingNames.has(`${column}_idx`)) continue
      await table.createIndex(column)
      existingNames.add(`${column}_idx`)
    }
  }

  private getTableConfigs(): TableConfig[] {
    return [
      {
        name: LANCE_TABLES.CHUNK,
        schema: new arrow.Schema([
          new arrow.Field(
            'vector',
            new arrow.FixedSizeList(768, new arrow.Field('item', new arrow.Float32()))
          ),
          new arrow.Field('text', new arrow.Utf8()),
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('document_id', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8()),
          new arrow.Field('generation_id', new arrow.Utf8()),
          new arrow.Field('chunk_index', new arrow.Int32()),
          new arrow.Field('document_name', new arrow.Utf8()),
          new arrow.Field('source_type', new arrow.Utf8()),
          new arrow.Field(
            'metadata',
            new arrow.Struct([new arrow.Field('page', new arrow.Int32())])
          ),
          new arrow.Field('created_at', new arrow.Int64())
        ]),
        ftsIndexConfig: {
          column: 'text',
          options: {
            config: lancedb.Index.fts({
              baseTokenizer: 'ngram',
              ngramMinLength: 2,
              ngramMaxLength: 3
            })
          }
        }
      }
    ]
  }
}
