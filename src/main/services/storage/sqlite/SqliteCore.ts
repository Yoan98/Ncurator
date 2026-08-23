import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { getSqliteDbPath } from '../../../utils/paths'
import type { Migration } from './migrations/types'
import { initialSchemaMigration } from './migrations/001_initial_schema'
import { aiRuntimeSystemNotificationsMigration } from './migrations/002_ai_runtime_system_notifications'
import { chatSessionSkillStateMigration } from './migrations/003_chat_session_skill_state'
import { resetResumeSnapshotsV2Migration } from './migrations/004_reset_resume_snapshots_v2'
import { repairFalseDocxChangeFailuresMigration } from './migrations/005_repair_false_docx_change_failures'
import { workbenchSessionUiStateMigration } from './migrations/006_workbench_session_ui_state'
import { aiRunExecutionPermissionMigration } from './migrations/007_ai_run_execution_permission'
import { dropLlmStrategyPreferenceMigration } from './migrations/008_drop_llm_strategy_preference'
import { repairAiRuntimeSystemNotificationsColumnMigration } from './migrations/009_repair_ai_runtime_system_notifications_column'
import { scheduledTaskMigration } from './migrations/010_scheduled_task'
import { chatSessionMessageLogMigration } from './migrations/011_chat_session_message_log'
import { dropChatConversationMemoryMigration } from './migrations/012_drop_chat_conversation_memory'

export type SqliteDatabase = Database.Database
export type SqliteStatement = Database.Statement

const MIGRATIONS: Migration[] = [
  initialSchemaMigration,
  aiRuntimeSystemNotificationsMigration,
  chatSessionSkillStateMigration,
  resetResumeSnapshotsV2Migration,
  repairFalseDocxChangeFailuresMigration,
  workbenchSessionUiStateMigration,
  aiRunExecutionPermissionMigration,
  dropLlmStrategyPreferenceMigration,
  repairAiRuntimeSystemNotificationsColumnMigration,
  scheduledTaskMigration,
  chatSessionMessageLogMigration,
  dropChatConversationMemoryMigration
]

const BETTER_SQLITE_NATIVE_BINDING_ENV = 'NCURATOR_BETTER_SQLITE3_NATIVE_BINDING'

const resolveRuntimeNativeDirName = (): string => {
  const runtime = process.versions.electron ? 'electron' : 'node'
  return `${runtime}-v${process.versions.modules}-${process.platform}-${process.arch}`
}

const resolveBetterSqliteNativeBinding = (): string => {
  const envBinding = String(process.env[BETTER_SQLITE_NATIVE_BINDING_ENV] || '').trim()
  if (envBinding) {
    if (!fs.existsSync(envBinding)) {
      throw new Error(`${BETTER_SQLITE_NATIVE_BINDING_ENV} does not exist: ${envBinding}`)
    }
    return envBinding
  }

  const dirName = resolveRuntimeNativeDirName()
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
  const candidates = [
    processWithResources.resourcesPath
      ? path.join(
          processWithResources.resourcesPath,
          'native',
          'better-sqlite3',
          dirName,
          'better_sqlite3.node'
        )
      : '',
    path.join(
      process.cwd(),
      'node_modules',
      '.native-cache',
      'better-sqlite3',
      dirName,
      'better_sqlite3.node'
    )
  ].filter(Boolean)

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    throw new Error(
      `better-sqlite3 native binding not found for ${dirName}; checked ${candidates.join(', ')}`
    )
  }
  return found
}

export class SqliteCore {
  private db: SqliteDatabase | null = null
  private readonly dbPath: string

  public constructor(dbPath?: string) {
    this.dbPath = dbPath || getSqliteDbPath()
  }

  public initialize(): void {
    if (this.db) return
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    const db = new Database(this.dbPath, {
      nativeBinding: resolveBetterSqliteNativeBinding()
    })
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    this.db = db
    this.runMigrations()
  }

  public getConnection(): SqliteDatabase {
    if (!this.db) throw new Error('SQLite database is not initialized')
    return this.db
  }

  public prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    sql: string
  ): Database.Statement<BindParameters, Result> {
    return this.getConnection().prepare(sql)
  }

  public exec(sql: string): void {
    this.getConnection().exec(sql)
  }

  public transaction<T>(fn: () => T): T {
    return this.getConnection().transaction(fn)()
  }

  public close(): void {
    if (!this.db) return
    this.db.close()
    this.db = null
  }

  private runMigrations(): void {
    const db = this.getConnection()
    this.assertMigrationDefinitions()
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
      version: number
    }>
    const applied = new Set(appliedRows.map((row) => Number(row.version)))
    const applyMigration = db.transaction((migration: Migration) => {
      if (migration.sql) db.exec(migration.sql)
      migration.run?.(db)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        Date.now()
      )
    })

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      applyMigration(migration)
    }
  }

  private assertMigrationDefinitions(): void {
    const versions = new Set<number>()
    for (const migration of MIGRATIONS) {
      if (versions.has(migration.version)) {
        throw new Error(`Duplicate SQLite migration version: ${migration.version}`)
      }
      versions.add(migration.version)
    }
  }
}
