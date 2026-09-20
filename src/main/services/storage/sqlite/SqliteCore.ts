import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { getSqliteDbPath } from '../../../utils/paths'
import type { Migration, MigrationAfterCommitContext } from './migrations/types'
import { initialSchemaMigration } from './migrations/001_initial_schema'
import { aiRuntimeSystemNotificationsMigration } from './migrations/002_ai_runtime_system_notifications'
import { chatSessionSkillStateMigration } from './migrations/003_chat_session_skill_state'
import { resetResumeSnapshotsV2Migration } from './migrations/004_reset_resume_snapshots_v2'
import { repairFalseDocxChangeFailuresMigration } from './migrations/005_repair_false_docx_change_failures'
import { workbenchSessionUiStateMigration } from './migrations/006_workbench_session_ui_state'
import { aiRunExecutionPermissionMigration } from './migrations/007_ai_run_execution_permission'
import { dropLlmStrategyPreferenceMigration } from './migrations/008_drop_llm_strategy_preference'
import { repairAiRuntimeSystemNotificationsColumnMigration } from './migrations/009_repair_ai_runtime_system_notifications_column'
import { upgradeFromV9Migration } from './migrations/010_upgrade_from_v9'
import { dropTerminalFileChangeRecordsMigration } from './migrations/011_drop_terminal_file_change_records'
import { appSettingsMigration } from './migrations/012_app_settings'

export type SqliteDatabase = Database.Database
export type SqliteStatement = Database.Statement

const MIGRATIONS: readonly Migration[] = [
  initialSchemaMigration,
  aiRuntimeSystemNotificationsMigration,
  chatSessionSkillStateMigration,
  resetResumeSnapshotsV2Migration,
  repairFalseDocxChangeFailuresMigration,
  workbenchSessionUiStateMigration,
  aiRunExecutionPermissionMigration,
  dropLlmStrategyPreferenceMigration,
  repairAiRuntimeSystemNotificationsColumnMigration,
  upgradeFromV9Migration,
  dropTerminalFileChangeRecordsMigration,
  appSettingsMigration
]

export const CURRENT_SCHEMA_VERSION = 12

const MIGRATION_NAME_ALIASES = new Map<number, ReadonlySet<string>>([
  [2, new Set(['workspace_change_sets'])]
])

type AppliedMigration = {
  version: number
  name: string
}

export class DatabaseVersionTooNewError extends Error {
  public readonly databaseVersion: number
  public readonly supportedDatabaseVersion: number

  public constructor(databaseVersion: number, supportedDatabaseVersion: number) {
    super(
      `SQLite schema version ${databaseVersion} is newer than supported version ${supportedDatabaseVersion}`
    )
    this.name = 'DatabaseVersionTooNewError'
    this.databaseVersion = databaseVersion
    this.supportedDatabaseVersion = supportedDatabaseVersion
  }
}

export class InvalidMigrationHistoryError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'InvalidMigrationHistoryError'
  }
}

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
    this.db = db
    try {
      db.pragma('foreign_keys = ON')
      db.pragma('busy_timeout = 5000')
      this.assertMigrationDefinitions()
      const applied = this.readAppliedMigrations()
      this.assertMigrationHistory(applied)
      db.pragma('journal_mode = WAL')
      this.runMigrations(applied)
    } catch (error) {
      db.close()
      this.db = null
      throw error
    }
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

  public async runPendingAfterCommitHooks(ctx: MigrationAfterCommitContext): Promise<void> {
    const db = this.getConnection()
    const table = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration_hooks'"
      )
      .get()
    if (!table) return

    const pending = db
      .prepare(
        `
        SELECT version, name FROM schema_migration_hooks
        WHERE status = 'pending'
        ORDER BY version ASC
      `
      )
      .all() as Array<{ version: number; name: string }>

    const markDone = db.prepare(
      `
      UPDATE schema_migration_hooks
      SET status = 'done', completed_at = ?
      WHERE version = ? AND status = 'pending'
    `
    )

    for (const row of pending) {
      const migration = MIGRATIONS.find((item) => item.version === Number(row.version))
      if (migration?.afterCommit) {
        await migration.afterCommit(ctx)
      }
      markDone.run(Date.now(), Number(row.version))
    }
  }

  private readAppliedMigrations(): AppliedMigration[] {
    const db = this.getConnection()
    const table = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get()
    if (!table) return []
    return db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC')
      .all()
      .map((row) => {
        const migration = row as { version: number; name: string }
        return { version: Number(migration.version), name: String(migration.name) }
      })
  }

  private assertMigrationHistory(applied: readonly AppliedMigration[]): void {
    const databaseVersion = applied.at(-1)?.version || 0
    if (databaseVersion > CURRENT_SCHEMA_VERSION) {
      throw new DatabaseVersionTooNewError(databaseVersion, CURRENT_SCHEMA_VERSION)
    }

    applied.forEach((row, index) => {
      const expectedVersion = index + 1
      if (row.version !== expectedVersion) {
        throw new InvalidMigrationHistoryError(
          `SQLite migration history must be contiguous: expected version ${expectedVersion}, found ${row.version}`
        )
      }
      const expectedName = MIGRATIONS[index]?.name
      const aliases = MIGRATION_NAME_ALIASES.get(row.version)
      if (row.name !== expectedName && !aliases?.has(row.name)) {
        throw new InvalidMigrationHistoryError(
          `SQLite migration ${row.version} name mismatch: expected ${expectedName}, found ${row.name}`
        )
      }
    })
  }

  private runMigrations(applied: readonly AppliedMigration[]): void {
    const pending = MIGRATIONS.slice(applied.length)
    if (pending.length === 0) return
    const db = this.getConnection()
    const applyPendingMigrations = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `)
      const insertMigration = db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      )
      for (const migration of pending) {
        if (migration.sql) db.exec(migration.sql)
        migration.run?.(db)
        insertMigration.run(migration.version, migration.name, Date.now())
        if (migration.afterCommit) {
          db.prepare(
            'INSERT INTO schema_migration_hooks (version, name, status) VALUES (?, ?, ?)'
          ).run(migration.version, migration.name, 'pending')
        }
      }

      const quickCheck = db.pragma('quick_check') as Array<{ quick_check: string }>
      if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== 'ok') {
        throw new Error(`SQLite quick_check failed: ${JSON.stringify(quickCheck)}`)
      }
      const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[]
      if (foreignKeyErrors.length > 0) {
        throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeyErrors)}`)
      }
    })
    applyPendingMigrations()
  }

  private assertMigrationDefinitions(): void {
    if (MIGRATIONS.length !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `SQLite migration definitions end at ${MIGRATIONS.length}, expected ${CURRENT_SCHEMA_VERSION}`
      )
    }
    MIGRATIONS.forEach((migration, index) => {
      const expectedVersion = index + 1
      if (migration.version !== expectedVersion) {
        throw new Error(
          `SQLite migrations must be contiguous: expected version ${expectedVersion}, found ${migration.version}`
        )
      }
    })
  }
}
