import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { SQLITE_DB_PATH } from '../../../utils/paths'
import { initialSchemaSql } from './migrations/001_initial_schema'

export type SqliteDatabase = Database.Database
export type SqliteStatement = Database.Statement

type Migration = {
  version: number
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchemaSql
  }
]

export class SqliteCore {
  private db: SqliteDatabase | null = null

  public constructor(private readonly dbPath: string = SQLITE_DB_PATH) {}

  public initialize(): void {
    if (this.db) return
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    const db = new Database(this.dbPath)
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
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, Date.now())
    })

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      applyMigration(migration)
    }
  }
}
