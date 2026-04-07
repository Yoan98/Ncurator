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
  WORKSPACE_NODE: 'workspace_node',
  CHAT_SESSION: 'chat_session',
  CHAT_MESSAGE: 'chat_message',
  CHAT_SESSION_MEMORY: 'chat_session_memory',
  DRAFT_REVIEW: 'draft_review',
  DRAFT_REVIEW_DOCUMENT: 'draft_review_document',
  DRAFT_REVIEW_CHANGE: 'draft_review_change',
  DRAFT_COMMIT_JOB: 'draft_commit_job',
  LLM_CONFIG: 'llm_config',
  AI_RUNTIME_SETTINGS: 'ai_runtime_settings'
} as const

export type LanceTableName = (typeof LANCE_TABLES)[keyof typeof LANCE_TABLES]

export class LanceDbCore {
  private db: lancedb.Connection | null = null
  private status: LanceDbCoreStatus = LanceDbCoreStatus.UNINITIALIZED

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
    const names = await this.db!.tableNames()
    return names.includes(name)
  }

  public async openTable(name: LanceTableName | string) {
    this.assertReady()
    const names = await this.db!.tableNames()
    if (!names.includes(String(name))) {
      throw new Error(`Table not found: ${String(name)}`)
    }
    return this.db!.openTable(String(name))
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

  public buildWhereFromKeyword(keyword?: string, fields?: string[]): string | undefined {
    const trimmed = String(keyword || '').trim()
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
          new arrow.Field('import_status', new arrow.Int32()),
          new arrow.Field('include_selectors_json', new arrow.Utf8(), true),
          new arrow.Field('exclude_selectors_json', new arrow.Utf8(), true),
          new arrow.Field('fetched_at', new arrow.Int64(), true),
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
          new arrow.Field('root_path', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('last_scan_at', new arrow.Int64(), true),
          new arrow.Field('last_prepare_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.WORKSPACE_NODE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('workspace_id', new arrow.Utf8()),
          new arrow.Field('parent_id', new arrow.Utf8(), true),
          new arrow.Field('kind', new arrow.Utf8()),
          new arrow.Field('name', new arrow.Utf8()),
          new arrow.Field('relative_path', new arrow.Utf8()),
          new arrow.Field('absolute_path', new arrow.Utf8()),
          new arrow.Field('file_ext', new arrow.Utf8(), true),
          new arrow.Field('exists', new arrow.Bool()),
          new arrow.Field('size', new arrow.Int64(), true),
          new arrow.Field('mtime_ms', new arrow.Int64(), true),
          new arrow.Field('content_hash', new arrow.Utf8(), true),
          new arrow.Field('prepare_status', new arrow.Utf8()),
          new arrow.Field('document_id', new arrow.Utf8(), true),
          new arrow.Field('last_prepared_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.CHAT_SESSION,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('title', new arrow.Utf8()),
          new arrow.Field('created_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.CHAT_MESSAGE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('role', new arrow.Utf8()),
          new arrow.Field('content', new arrow.Utf8()),
          new arrow.Field('timestamp', new arrow.Int64()),
          new arrow.Field('sources', new arrow.Utf8(), true),
          new arrow.Field('error', new arrow.Bool(), true)
        ])
      },
      {
        name: LANCE_TABLES.CHAT_SESSION_MEMORY,
        schema: new arrow.Schema([
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('memory_json', new arrow.Utf8()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.DRAFT_REVIEW,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('session_id', new arrow.Utf8()),
          new arrow.Field('run_id', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('title', new arrow.Utf8()),
          new arrow.Field('document_count', new arrow.Int32()),
          new arrow.Field('change_count', new arrow.Int32()),
          new arrow.Field('pending_change_count', new arrow.Int32()),
          new arrow.Field('accepted_change_count', new arrow.Int32()),
          new arrow.Field('rejected_change_count', new arrow.Int32()),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64()),
          new arrow.Field('completed_at', new arrow.Int64(), true),
          new arrow.Field('committed_at', new arrow.Int64(), true),
          new arrow.Field('last_error', new arrow.Utf8(), true)
        ])
      },
      {
        name: LANCE_TABLES.DRAFT_REVIEW_DOCUMENT,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('review_id', new arrow.Utf8()),
          new arrow.Field('source_document_id', new arrow.Utf8(), true),
          new arrow.Field('source_path', new arrow.Utf8()),
          new arrow.Field('source_name', new arrow.Utf8()),
          new arrow.Field('format', new arrow.Utf8()),
          new arrow.Field('latest_draft_snapshot_id', new arrow.Utf8()),
          new arrow.Field('preview_artifact_path', new arrow.Utf8(), true),
          new arrow.Field('draft_artifact_path', new arrow.Utf8(), true),
          new arrow.Field('source_version_json', new arrow.Utf8()),
          new arrow.Field('total_change_count', new arrow.Int32()),
          new arrow.Field('pending_change_count', new arrow.Int32()),
          new arrow.Field('accepted_change_count', new arrow.Int32()),
          new arrow.Field('rejected_change_count', new arrow.Int32()),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.DRAFT_REVIEW_CHANGE,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('review_id', new arrow.Utf8()),
          new arrow.Field('document_id', new arrow.Utf8()),
          new arrow.Field('order_index', new arrow.Int32()),
          new arrow.Field('change_kind', new arrow.Utf8()),
          new arrow.Field('title', new arrow.Utf8()),
          new arrow.Field('summary', new arrow.Utf8()),
          new arrow.Field('decision', new arrow.Utf8()),
          new arrow.Field('before_text', new arrow.Utf8()),
          new arrow.Field('after_text', new arrow.Utf8()),
          new arrow.Field('locator_json', new arrow.Utf8()),
          new arrow.Field('preview_artifact_path', new arrow.Utf8(), true),
          new arrow.Field('metadata_json', new arrow.Utf8(), true),
          new arrow.Field('created_at', new arrow.Int64()),
          new arrow.Field('updated_at', new arrow.Int64())
        ])
      },
      {
        name: LANCE_TABLES.DRAFT_COMMIT_JOB,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('review_id', new arrow.Utf8()),
          new arrow.Field('status', new arrow.Utf8()),
          new arrow.Field('document_count', new arrow.Int32()),
          new arrow.Field('results_json', new arrow.Utf8()),
          new arrow.Field('started_at', new arrow.Int64()),
          new arrow.Field('completed_at', new arrow.Int64(), true),
          new arrow.Field('error', new arrow.Utf8(), true)
        ])
      },
      {
        name: LANCE_TABLES.LLM_CONFIG,
        recreateIfSchemaChanged: true,
        schema: new arrow.Schema([
          new arrow.Field('id', new arrow.Utf8()),
          new arrow.Field('name', new arrow.Utf8()),
          new arrow.Field('base_url', new arrow.Utf8()),
          new arrow.Field('model_name', new arrow.Utf8()),
          new arrow.Field('api_key', new arrow.Utf8()),
          new arrow.Field('is_active', new arrow.Bool()),
          new arrow.Field('preferredStructuredOutputProfile', new arrow.Utf8(), true),
          new arrow.Field('preferredTransport', new arrow.Utf8(), true)
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
