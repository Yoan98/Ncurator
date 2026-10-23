import * as lancedb from '@lancedb/lancedb'
import fs from 'fs'
import * as arrow from 'apache-arrow'
import { createHash } from 'node:crypto'
import { getLanceDbPath } from '../../../utils/paths'
import type { TableConfig } from '../../../types/store'
import type { AppErrorLogService } from '../../logging/AppErrorLogService'

enum LanceDbCoreStatus {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error'
}

export const LANCE_TABLES = {
  CHUNK: 'vector_chunk'
} as const

export const DEFAULT_EMBEDDING_IDENTITY = 'local:jinaai/jina-embeddings-v2-base-zh'
export const DEFAULT_EMBEDDING_DIMENSION = 768

const DYNAMIC_CHUNK_TABLE_PATTERN = /^vector_chunk_[a-f0-9]{64}_([1-9]\d*)$/

export class LanceDbCore {
  private db: lancedb.Connection | null = null
  private readonly dbPath: string
  private status: LanceDbCoreStatus = LanceDbCoreStatus.UNINITIALIZED
  private tableNamesCache: Set<string> | null = null
  private tableCache = new Map<string, lancedb.Table>()
  private tableWriteQueues = new Map<string, Promise<unknown>>()
  private chunkTableInitializations = new Map<string, Promise<void>>()

  public constructor(
    dbPath?: string,
    private readonly errorLogService?: AppErrorLogService
  ) {
    this.dbPath = dbPath || getLanceDbPath()
  }

  public getDbPath(): string {
    return this.dbPath
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
      this.logError(error instanceof Error ? error : String(error), 'initialize')
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
    this.chunkTableInitializations.clear()
    this.db = null
    this.status = LanceDbCoreStatus.UNINITIALIZED
  }

  public async tableExists(name: string): Promise<boolean> {
    this.assertReady()
    const names = await this.getTableNames()
    return names.has(name)
  }

  public async openTable(name: string): Promise<lancedb.Table> {
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

  public getChunkTableName(embeddingIdentity: string, dimension: number): string {
    if (!embeddingIdentity.trim()) throw new Error('Embedding identity must not be empty')
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new Error('Embedding dimension must be a positive integer')
    }
    if (
      embeddingIdentity === DEFAULT_EMBEDDING_IDENTITY &&
      dimension === DEFAULT_EMBEDDING_DIMENSION
    ) {
      return LANCE_TABLES.CHUNK
    }
    const hash = createHash('sha256').update(embeddingIdentity).digest('hex')
    return `${LANCE_TABLES.CHUNK}_${hash}_${dimension}`
  }

  public async listChunkTableNames(): Promise<string[]> {
    this.assertReady()
    const names = await this.getTableNames()
    return [...names]
      .filter((name) => name === LANCE_TABLES.CHUNK || DYNAMIC_CHUNK_TABLE_PATTERN.test(name))
      .sort()
  }

  /**
   * 模型身份与维度共同确定表，历史本地模型继续使用原表。并发首次写入共享初始化任务。
   *
   * Model identity and dimension determine the table, preserving the legacy local table.
   * Concurrent first writes share the same initialization task.
   */
  public async openChunkTable(
    embeddingIdentity = DEFAULT_EMBEDDING_IDENTITY,
    dimension = DEFAULT_EMBEDDING_DIMENSION,
    create = false
  ): Promise<lancedb.Table | null> {
    this.assertReady()
    const name = this.getChunkTableName(embeddingIdentity, dimension)
    if (!create) return (await this.tableExists(name)) ? this.openTable(name) : null
    let initialization = this.chunkTableInitializations.get(name)
    if (!initialization) {
      initialization = this.ensureTable(this.getChunkTableConfig(name, dimension))
      this.chunkTableInitializations.set(name, initialization)
    }
    try {
      await initialization
    } catch (error) {
      this.chunkTableInitializations.delete(name)
      throw error
    }
    return this.openTable(name)
  }

  public async ensureLanceScalarIndexes(name: string, columns: string[]): Promise<void> {
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

  public async optimizeTables(names: string[]): Promise<void> {
    const expandedNames = new Set(names)
    if (expandedNames.has(LANCE_TABLES.CHUNK)) {
      for (const name of await this.listChunkTableNames()) expandedNames.add(name)
    }
    for (const name of expandedNames) {
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

  public buildNotInClause(column: string, values?: string[]): string | undefined {
    const list = (values || []).map((v) => String(v || '').trim()).filter(Boolean)
    if (list.length === 0) return undefined
    return `${column} NOT IN (${list.map((v) => `'${this.escapeSqlString(v)}'`).join(',')})`
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
    try {
      return await queued
    } catch (error) {
      this.logError(error instanceof Error ? error : String(error), 'write', tableName)
      throw error
    }
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
    await this.ensureTable(
      this.getChunkTableConfig(LANCE_TABLES.CHUNK, DEFAULT_EMBEDDING_DIMENSION)
    )
    for (const name of await this.getTableNames()) {
      const match = DYNAMIC_CHUNK_TABLE_PATTERN.exec(name)
      if (match) await this.ensureTable(this.getChunkTableConfig(name, Number(match[1])))
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

    if (config.ftsIndexConfig) {
      const indices = await table.listIndices()
      const column = config.ftsIndexConfig.column
      if (!indices.some((index) => index.columns.includes(column))) {
        await table.createIndex(column, config.ftsIndexConfig.options)
      }
    }

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

    const error = new Error(
      [
        `LanceDB table schema mismatch: ${config.name}`,
        `current=[${currentFields.join(', ')}]`,
        `expected=[${nextFields.join(', ')}]`,
        'Existing data was preserved. Check the table schema before rebuilding its index.'
      ].join(' ')
    )
    this.logError(error, 'schema-mismatch', config.name)
    throw error
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

  private getChunkTableConfig(name: string, dimension: number): TableConfig {
    return {
      name,
      schema: new arrow.Schema([
        new arrow.Field(
          'vector',
          new arrow.FixedSizeList(dimension, new arrow.Field('item', new arrow.Float32()))
        ),
        new arrow.Field('text', new arrow.Utf8()),
        new arrow.Field('id', new arrow.Utf8()),
        new arrow.Field('document_id', new arrow.Utf8()),
        new arrow.Field('workspace_id', new arrow.Utf8()),
        new arrow.Field('generation_id', new arrow.Utf8()),
        new arrow.Field('chunk_index', new arrow.Int32()),
        new arrow.Field('document_name', new arrow.Utf8()),
        new arrow.Field('source_type', new arrow.Utf8()),
        new arrow.Field('metadata', new arrow.Struct([new arrow.Field('page', new arrow.Int32())])),
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
  }

  private logError(error: Error | string, operation: string, table?: string): void {
    this.errorLogService?.write({
      module: 'lancedb',
      error,
      context: { operation, table }
    })
  }
}
