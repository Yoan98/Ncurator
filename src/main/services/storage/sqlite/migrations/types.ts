import type Database from 'better-sqlite3'

export type SqliteDatabase = Database.Database

export type MigrationAfterCommitContext = {
  lanceDbPath: string
}

export type Migration = {
  version: number
  name: string
  sql?: string
  run?: (db: SqliteDatabase) => void
  afterCommit?: (ctx: MigrationAfterCommitContext) => void | Promise<void>
}
