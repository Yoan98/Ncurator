import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { getSqliteDbPath } from '../../../utils/paths'
import { initialSchemaSql } from './migrations/001_initial_schema'

const notificationSettingsMigration = `
ALTER TABLE ai_runtime_settings ADD COLUMN systemNotificationsEnabled INTEGER NOT NULL DEFAULT 1;
`

const dropLlmStrategyPreferenceMigration = `
DROP TABLE IF EXISTS llm_strategy_preference;
`

const sessionSkillStateMigration = `
CREATE TABLE IF NOT EXISTS chat_session_skill_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
`

const resetResumeSnapshotsV2Migration = `
DELETE FROM chat_session_resume_snapshot;
`

const repairFalseDocxChangeFailuresMigration = `
UPDATE ai_file_change
SET status = 'applied', last_error = NULL
WHERE status = 'failed'
  AND last_error = 'Run completed without an effective workspace change.'
  AND EXISTS (
    SELECT 1
    FROM docx_apply
    WHERE docx_apply.id = ai_file_change.id
      AND docx_apply.status = 'applied'
      AND COALESCE(docx_apply.before_checksum, '') <> COALESCE(docx_apply.after_checksum, '')
  );
`

const workbenchSessionUiStateMigration = `
CREATE TABLE IF NOT EXISTS chat_session_ui_state (
  session_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workbench_ui_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_view_key TEXT,
  draft_state_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_tab_state (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL DEFAULT '',
  zoom_factor REAL NOT NULL DEFAULT 1,
  history_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_tab_state_owner
  ON browser_tab_state(owner_key, position, created_at);
`

const aiRunExecutionPermissionMigration = `
ALTER TABLE ai_run ADD COLUMN execution_permission TEXT NOT NULL DEFAULT 'review';
`

const scheduledTaskMigration = `
CREATE TABLE IF NOT EXISTS scheduled_task (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  time_of_day TEXT NOT NULL DEFAULT '09:00',
  weekday INTEGER,
  workspace_id TEXT NOT NULL DEFAULT '',
  main_model_config_id TEXT NOT NULL DEFAULT '',
  main_model_name TEXT NOT NULL DEFAULT '',
  vision_model_config_id TEXT,
  vision_model_name TEXT,
  ai_preference TEXT NOT NULL DEFAULT 'default',
  execution_permission TEXT NOT NULL DEFAULT 'full_access',
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_enabled
  ON scheduled_task(enabled, next_run_at);
`

type SqliteColumnInfo = {
  name: string
}

const repairNotificationSettingsColumn = (db: SqliteDatabase): void => {
  const columns = db.prepare('PRAGMA table_info(ai_runtime_settings)').all() as SqliteColumnInfo[]
  if (columns.some((column) => column.name === 'systemNotificationsEnabled')) return
  db.exec(
    'ALTER TABLE ai_runtime_settings ADD COLUMN systemNotificationsEnabled INTEGER NOT NULL DEFAULT 1;'
  )
}

export type SqliteDatabase = Database.Database
export type SqliteStatement = Database.Statement

type Migration = {
  version: number
  name: string
  sql?: string
  run?: (db: SqliteDatabase) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchemaSql
  },
  {
    version: 2,
    name: 'ai_runtime_system_notifications',
    sql: notificationSettingsMigration
  },
  {
    version: 3,
    name: 'chat_session_skill_state',
    sql: sessionSkillStateMigration
  },
  {
    version: 4,
    name: 'reset_resume_snapshots_v2',
    sql: resetResumeSnapshotsV2Migration
  },
  {
    version: 5,
    name: 'repair_false_docx_change_failures',
    sql: repairFalseDocxChangeFailuresMigration
  },
  {
    version: 6,
    name: 'workbench_session_ui_state',
    sql: workbenchSessionUiStateMigration
  },
  {
    version: 7,
    name: 'ai_run_execution_permission',
    sql: aiRunExecutionPermissionMigration
  },
  {
    version: 8,
    name: 'drop_llm_strategy_preference',
    sql: dropLlmStrategyPreferenceMigration
  },
  {
    version: 9,
    name: 'repair_ai_runtime_system_notifications_column',
    run: repairNotificationSettingsColumn
  },
  {
    version: 10,
    name: 'scheduled_task',
    sql: scheduledTaskMigration
  }
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
