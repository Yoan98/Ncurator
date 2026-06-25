import * as lancedb from '@lancedb/lancedb'
import fs from 'fs'
import * as arrow from 'apache-arrow'
import { LANCE_DB_PATH } from '../../../utils/paths'
import type { TableConfig } from '../../../types/store'

export enum LanceDbCoreStatus {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error'
}

export const LANCE_TABLES = {
  CHUNK: 'chunk',
  DOCUMENT: 'document',
  WEB_SOURCE: 'web_source',
  WORKSPACE_SOURCE: 'workspace_source',
  WORKSPACE_FILE_INDEX: 'workspace_file_index',
  WORKSPACE_INDEX_JOB: 'workspace_index_job',
  CHAT_SESSION: 'chat_session',
  CHAT_MESSAGE: 'chat_message',
  CHAT_CONVERSATION_MEMORY: 'chat_conversation_memory',
  CHAT_SESSION_RESUME_SNAPSHOT: 'chat_session_resume_snapshot',
  AI_RUN: 'ai_run',
  AI_RUN_EVENT: 'ai_run_event',
  AI_FILE_CHANGE: 'ai_file_change',
  DOCX_APPLY: 'docx_apply',
  LLM_CONFIG: 'llm_config',
  AI_RUNTIME_SETTINGS: 'ai_runtime_settings'
} as const

export type LanceTableName = (typeof LANCE_TABLES)[keyof typeof LANCE_TABLES]

export class LanceDbCore {
  private db: lancedb.Connection | null = null
  private status: LanceDbCoreStatus = LanceDbCoreStatus.UNINITIALIZED
  private operationQueue: Promise<void> = Promise.resolve()

  public constructor(private readonly dbPath: string = LANCE_DB_PATH) {}

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
    this.db = null
    this.status = LanceDbCoreStatus.UNINITIALIZED
  }

  public getConnection(): lancedb.Connection {
    this.assertReady()
    return this.db!
  }

  public async tableExists(name: string): Promise<boolean> {
    this.assertReady()
    return await this.runSerialized(async () => {
      const names = await this.db!.tableNames()
      return names.includes(name)
    })
  }

  public async openTable(name: LanceTableName | string) {
    this.assertReady()
    return await this.runSerialized(async () => {
      const names = await this.db!.tableNames()
      if (!names.includes(String(name))) {
        throw new Error(`Table not found: ${String(name)}`)
      }
      const table = await this.db!.openTable(String(name))
      return this.createSerializedTable(table)
    })
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

  private async runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue
    let release: () => void = () => undefined
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private createSerializedTable<TTable extends object>(table: TTable): TTable {
    return new Proxy(table, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (property === 'query' && typeof value === 'function') {
          return (...args: unknown[]) => this.createSerializedQuery(value.apply(target, args))
        }
        if (typeof value !== 'function') return value
        return (...args: unknown[]) =>
          this.runSerialized(async () => await Promise.resolve(value.apply(target, args)))
      }
    })
  }

  private createSerializedQuery<TQuery extends object>(query: TQuery): TQuery {
    return new Proxy(query, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        if (property === 'toArray') {
          return (...args: unknown[]) =>
            this.runSerialized(async () => await Promise.resolve(value.apply(target, args)))
        }
        return (...args: unknown[]) => {
          const result = value.apply(target, args)
          if (result && typeof result === 'object' && typeof result.toArray === 'function') {
            return this.createSerializedQuery(result)
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

    const tableNames = await this.db.tableNames()
    if (!tableNames.includes(config.name)) {
      await this.createTable(config)
      return
    }

    if (config.recreateIfSchemaChanged) {
      const table = await this.db.openTable(config.name)
      const currentSchema = await table.schema()
      const currentFieldNames = currentSchema.fields.map((field) => field.name)
      const nextFieldNames = config.schema.fields.map((field) => field.name)
      const schemaChanged =
        currentFieldNames.length !== nextFieldNames.length ||
        currentFieldNames.some((fieldName, index) => fieldName !== nextFieldNames[index])

      if (schemaChanged) {
        await this.db.dropTable(config.name)
        await this.createTable(config)
      }
    }
  }

  private async createTable(config: TableConfig): Promise<void> {
    if (!this.db) throw new Error('Database connection not established')

    const table = await this.db.createEmptyTable(config.name, config.schema)

    if (config.vectorIndexConfig) {
      await table.createIndex(config.vectorIndexConfig.column, config.vectorIndexConfig.options)
    }

    if (config.ftsIndexConfig) {
      await table.createIndex(config.ftsIndexConfig.column, config.ftsIndexConfig.options)
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
          new arrow.Field('document_name', new arrow.Utf8()),
          new arrow.Field('source_type', new arrow.Utf8()),
          new arrow.Field(
            'metadata',
            new arrow.Struct([new arrow.Field('page', new arrow.Int32())])
          ),
          new arrow.Field('created_at', new arrow.Int64())
        ]),
        recreateIfSchemaChanged: true,
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
      },
      {
        name: LANCE_TABLES.DOCUMENT,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('name', new arrow.Utf8()),
          new arrow.Field('source_type', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8(), true),
          new arrow.Field('file_path', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('import_status', new arrow.Int32())
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.WEB_SOURCE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8()),
          new arrow.Field('identity_kind', new arrow.Utf8()),
          new arrow.Field('normalized_url', new arrow.Utf8()),
          new arrow.Field('url', new arrow.Utf8()),
          new arrow.Field('title', new arrow.Utf8(), true),
          new arrow.Field('document_id', new arrow.Utf8(), true),
          new arrow.Field('index_status', new arrow.Utf8()),
          new arrow.Field('include_selectors_json', new arrow.Utf8(), true),
          new arrow.Field('exclude_selectors_json', new arrow.Utf8(), true),
          new arrow.Field('fetched_at', new arrow.Int64(), true),
          new arrow.Field('last_checked_at', new arrow.Int64(), true),
          new arrow.Field('last_crawled_at', new arrow.Int64(), true),
          new arrow.Field('last_indexed_at', new arrow.Int64(), true),
          new arrow.Field('etag', new arrow.Utf8(), true),
          new arrow.Field('last_modified', new arrow.Utf8(), true),
          new arrow.Field('content_length', new arrow.Int64(), true),
          new arrow.Field('content_hash', new arrow.Utf8(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.WORKSPACE_SOURCE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('name', new arrow.Utf8()),
          new arrow.Field('root_path', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.WORKSPACE_FILE_INDEX,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8()),
          new arrow.Field('relative_path', new arrow.Utf8()),
          new arrow.Field('absolute_path', new arrow.Utf8()),
          new arrow.Field('name', new arrow.Utf8()),
          new arrow.Field('file_ext', new arrow.Utf8()),
          new arrow.Field('size', new arrow.Int64(), true),
          new arrow.Field('mtime_ms', new arrow.Int64(), true),
          new arrow.Field('content_hash', new arrow.Utf8(), true),
          new arrow.Field('index_status', new arrow.Utf8()),
          new arrow.Field('document_id', new arrow.Utf8(), true),
          new arrow.Field('indexed_at', new arrow.Int64(), true),
          new arrow.Field('last_checked_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.WORKSPACE_INDEX_JOB,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8()),
          new arrow.Field('source_kind', new arrow.Utf8()),
          new arrow.Field('action', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('phase', new arrow.Utf8()),
          new arrow.Field('step_index', new arrow.Int64()),
          new arrow.Field('step_total', new arrow.Int64()),
          new arrow.Field('total_count', new arrow.Int64()),
          new arrow.Field('processed_count', new arrow.Int64()),
          new arrow.Field('failed_count', new arrow.Int64()),
          new arrow.Field('target_ids_json', new arrow.Utf8()),
          new arrow.Field('message', new arrow.Utf8(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true),
          new arrow.Field('started_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64()),
          new arrow.Field('finished_at', new arrow.Int64(), true)
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.CHAT_SESSION,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('title', new arrow.Utf8()),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('workspace_id', new arrow.Utf8())
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.CHAT_MESSAGE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('role', new arrow.Utf8()),
          new arrow.Field('content', new arrow.Utf8()),
          new arrow.Field('timestamp', new arrow.Int64()),
          new arrow.Field('content_nodes_json', new arrow.Utf8(), true),
          new arrow.Field('selected_references_json', new arrow.Utf8(), true),
          new arrow.Field('artifacts_json', new arrow.Utf8(), true),
          new arrow.Field('error', new arrow.Bool(), true)
        ]),
        recreateIfSchemaChanged: true
      },
      {
        name: LANCE_TABLES.CHAT_CONVERSATION_MEMORY,
        schema: new arrow.Schema([
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('memory_json', new arrow.Utf8()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.CHAT_SESSION_RESUME_SNAPSHOT,
        schema: new arrow.Schema([
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('run_id', new arrow.Utf8()),
          new arrow.Field('reason', new arrow.Utf8()),
          new arrow.Field('user_input', new arrow.Utf8()),
          new arrow.Field('selected_references_json', new arrow.Utf8()),
          new arrow.Field('workspace_json', new arrow.Utf8(), true),
          new arrow.Field('human_state_json', new arrow.Utf8()),
          new arrow.Field('error_message', new arrow.Utf8()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.AI_RUN,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('user_message_id', new arrow.Utf8()),
          new arrow.Field('assistant_message_id', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('input', new arrow.Utf8()),
          new arrow.Field('selected_references_json', new arrow.Utf8(), true),
          new arrow.Field('workspace_json', new arrow.Utf8(), true),
          new arrow.Field('model_name', new arrow.Utf8(), true),
          new arrow.Field('partial_answer', new arrow.Utf8()),
          new arrow.Field('final_answer', new arrow.Utf8(), true),
          new arrow.Field('error', new arrow.Utf8(), true),
          new arrow.Field('pending_approval_json', new arrow.Utf8(), true),
          new arrow.Field('artifacts_json', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64()),
          new arrow.Field('finished_at', new arrow.Int64(), true)
        ])
      },
      {
        name: LANCE_TABLES.AI_RUN_EVENT,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('run_id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('seq', new arrow.Int64()),
          new arrow.Field('type', new arrow.Utf8()),
          new arrow.Field('event_json', new arrow.Utf8()),
          new arrow.Field('created_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.AI_FILE_CHANGE,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('run_id', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('capability', new arrow.Utf8()),
          new arrow.Field('path', new arrow.Utf8()),
          new arrow.Field('file_name', new arrow.Utf8()),
          new arrow.Field('operation', new arrow.Utf8()),
          new arrow.Field('change_count', new arrow.Int32()),
          new arrow.Field('before_snapshot_path', new arrow.Utf8(), true),
          new arrow.Field('before_checksum', new arrow.Utf8(), true),
          new arrow.Field('after_checksum', new arrow.Utf8(), true),
          new arrow.Field('preview_path', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64()),
          new arrow.Field('reverted_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true)
        ])
      },
      {
        name: LANCE_TABLES.DOCX_APPLY,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('run_id', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('source_path', new arrow.Utf8()),
          new arrow.Field('source_name', new arrow.Utf8()),
          new arrow.Field('operation', new arrow.Utf8()),
          new arrow.Field('final_revision_ref', new arrow.Utf8()),
          new arrow.Field('change_count', new arrow.Int32()),
          new arrow.Field('before_exists', new arrow.Bool()),
          new arrow.Field('before_snapshot_path', new arrow.Utf8(), true),
          new arrow.Field('before_checksum', new arrow.Utf8(), true),
          new arrow.Field('before_byte_size', new arrow.Int64(), true),
          new arrow.Field('before_modified_at', new arrow.Int64(), true),
          new arrow.Field('preview_diff_artifact_path', new arrow.Utf8()),
          new arrow.Field('preview_diff_checksum', new arrow.Utf8()),
          new arrow.Field('preview_diff_byte_size', new arrow.Int64()),
          new arrow.Field('after_checksum', new arrow.Utf8(), true),
          new arrow.Field('after_byte_size', new arrow.Int64(), true),
          new arrow.Field('after_modified_at', new arrow.Int64(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64()),
          new arrow.Field('reverted_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true)
        ])
      },
      {
        name: LANCE_TABLES.LLM_CONFIG,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('providerKind', new arrow.Utf8()),
          new arrow.Field('base_url', new arrow.Utf8()),
          new arrow.Field('api_key', new arrow.Utf8()),
          new arrow.Field('is_active', new arrow.Bool()),
          new arrow.Field('default_model', new arrow.Utf8())
        ])
      },
      {
        name: LANCE_TABLES.AI_RUNTIME_SETTINGS,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('llmStreamingMode', new arrow.Utf8()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      }
    ]
  }
}
